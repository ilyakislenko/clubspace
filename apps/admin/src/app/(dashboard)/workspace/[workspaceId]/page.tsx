"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { useWorkspaceRealtime } from "../../../../shared/realtime/useWorkspaceRealtime"
import {
  getWorkspaceStats,
  type WorkspaceStats,
} from "../../../../shared/api/stats"
import {
  getLeaderboard,
  type Leaderboard,
} from "../../../../shared/api/leaderboard"
import { listPendingUsers } from "../../../../shared/api/members"
import { listAtRiskMembers } from "../../../../shared/api/retention"
import { listRenewalCandidates } from "../../../../shared/api/subscriptions"
import {
  ACTION_META,
  formatActor,
  targetTypeLabel,
} from "../../../../features/audit/audit-meta"
import { errorMessage } from "../../../../shared/lib/error-message"
import { isWorkspaceAdmin } from "../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../shared/lib/use-my-membership"
import { formatAmount } from "../../../../features/subscriptions/subscription-display"

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

const formatRelative = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "только что"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} мин назад`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} ч назад`
  return `${Math.floor(ms / 86_400_000)} дн назад`
}

const numberFmt = new Intl.NumberFormat("ru-RU")
const formatMoney = (amount: number, currency: string | null) =>
  currency ? formatAmount(amount, currency) : numberFmt.format(amount)

const monthFmt = new Intl.DateTimeFormat("ru-RU", { month: "short" })
// "2026-07" → "июл" (with the year appended in January so a 6-month window
// spanning a year boundary stays readable).
const formatMonth = (key: string) => {
  const [year, month] = key.split("-").map(Number)
  const label = monthFmt.format(new Date(year, month - 1, 1))
  return month === 1 ? `${label} ${String(year).slice(2)}` : label
}

export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const canAdmin = isWorkspaceAdmin(useMyMembership(workspaceId))

  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
  const [renewalsDue, setRenewalsDue] = useState<number | null>(null)
  const [atRisk, setAtRisk] = useState<number | null>(null)
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Refetch stats + leaderboard. Doesn't toggle `loading` so a live refresh
  // updates the cards in place instead of blanking the page.
  const load = useCallback(async () => {
    if (!workspaceId) return
    await Promise.all([
      (async () => {
        try {
          setStats(await getWorkspaceStats({ workspaceId }))
          setError(null)
        } catch (err) {
          setError(errorMessage(err, "Не удалось загрузить статистику."))
        } finally {
          setLoading(false)
        }
      })(),
      // Best-effort side panel — a failure must not blank the dashboard.
      (async () => {
        try {
          setLeaderboard(await getLeaderboard({ workspaceId, period: "month" }))
        } catch {
          setLeaderboard(null)
        }
      })(),
      // Best-effort: the card is only shown to admins (see below).
      (async () => {
        try {
          const res = await listPendingUsers({ workspaceId })
          setPendingCount(res.data.length)
        } catch {
          setPendingCount(null)
        }
      })(),
    ])
  }, [workspaceId])

  // Admin-only endpoint — own effect so the membership resolving doesn't
  // re-run the stats/leaderboard load above.
  const loadRenewals = useCallback(async () => {
    if (!workspaceId || !canAdmin) return
    try {
      const res = await listRenewalCandidates({ workspaceId })
      setRenewalsDue(res.data.length)
    } catch {
      setRenewalsDue(null)
    }
  }, [workspaceId, canAdmin])

  // Best-effort and visible to all staff (the server scopes it for coaches).
  const loadAtRisk = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listAtRiskMembers({ workspaceId })
      setAtRisk(res.summary.total)
    } catch {
      setAtRisk(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadRenewals()
  }, [loadRenewals])

  useEffect(() => {
    void loadAtRisk()
  }, [loadAtRisk])

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    void load()
  }, [workspaceId, load])

  // Live-refresh as members join/leave, check in, buy abonements, get promoted…
  useWorkspaceRealtime(
    workspaceId,
    [
      "members",
      "attendance",
      "leaderboard",
      "subscription",
      "announcements",
      "ranks",
    ],
    () => {
      void load()
      void loadRenewals()
      void loadAtRisk()
    },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Обзор клуба</h1>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {stats?.revenue && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Финансы</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Выручка в месяц (оценка)"
              value={formatMoney(stats.revenue.mrr, stats.revenue.currency)}
              subtitle="ежемесячно по активным абонементам"
              loading={loading}
            />
            <StatCard
              label="Выручка за 30 дней"
              value={formatMoney(
                stats.revenue.revenue30d,
                stats.revenue.currency,
              )}
              loading={loading}
            />
            <StatCard
              label="Активные абонементы"
              value={stats.revenue.activeSubscriptions}
              loading={loading}
              href={`/workspace/${workspaceId}/subscriptions`}
            />
            <StatCard
              label="Ожидают оплаты"
              value={formatMoney(
                stats.revenue.awaitingPayment.amount,
                stats.revenue.currency,
              )}
              subtitle={`не оплачено абонементов: ${stats.revenue.awaitingPayment.count}`}
              tone={stats.revenue.awaitingPayment.count > 0 ? "warn" : "default"}
              loading={loading}
              href={`/workspace/${workspaceId}/subscriptions`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RevenueTrend
              data={stats.revenue.trend}
              currency={stats.revenue.currency}
            />
            <PlanBreakdown
              data={stats.revenue.byPlan}
              currency={stats.revenue.currency}
            />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Продления и удержание</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Ученики"
            value={stats?.counts.members}
            loading={loading}
            href={`/workspace/${workspaceId}/users`}
          />
          {canAdmin && (
            <StatCard
              label="К продлению"
              value={renewalsDue ?? undefined}
              subtitle="заканчиваются занятия / доступ"
              loading={loading}
              href={`/workspace/${workspaceId}/subscriptions`}
            />
          )}
          {canAdmin && pendingCount !== null && (
            <StatCard
              label="Заявки"
              value={pendingCount}
              subtitle="ожидают одобрения"
              loading={loading}
              tone={pendingCount > 0 ? "warn" : "default"}
              href={`/workspace/${workspaceId}/users`}
            />
          )}
          <StatCard
            label="Под риском"
            value={atRisk ?? undefined}
            subtitle="могут уйти — позвоните"
            loading={loading}
            tone="warn"
            href={`/workspace/${workspaceId}/retention`}
          />
          <StatCard
            label="Неактивны за месяц"
            value={stats?.retention.inactiveMembers30d}
            subtitle="без отметок 30 дней"
            loading={loading}
            tone="warn"
            href={`/workspace/${workspaceId}/users?filter=inactive`}
          />
          <StatCard
            label="Доступ истекает"
            value={stats?.retention.expiringSoon}
            subtitle="в ближайшие 14 дней"
            loading={loading}
            tone="warn"
            href={`/workspace/${workspaceId}/users?filter=expiring`}
          />
          <StatCard
            label="Доступ закончился"
            value={stats?.retention.expiredAccess}
            subtitle="требуют продления"
            loading={loading}
            tone="danger"
            href={`/workspace/${workspaceId}/users?filter=expired`}
          />
        </div>
      </section>

      {stats && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Сегодня</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Занятий сегодня по расписанию"
              value={stats.today.sessions}
              loading={loading}
            />
            <StatCard
              label="Отметок сегодня"
              value={stats.today.checkins}
              subtitle="учеников отметилось"
              loading={loading}
            />
            <StatCard
              label="Новые участники"
              value={stats.today.newMembers}
              subtitle="вступили сегодня"
              loading={loading}
              href={`/workspace/${workspaceId}/users`}
            />
            {stats.today.revenue !== null && (
              <StatCard
                label="Выручка сегодня"
                value={formatMoney(stats.today.revenue, stats.today.currency)}
                loading={loading}
              />
            )}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Посещаемость</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Активны за неделю"
            value={stats?.activity.activeMembers7d}
            subtitle={
              stats && stats.counts.members > 0
                ? `${Math.round(
                    (stats.activity.activeMembers7d / stats.counts.members) *
                      100,
                  )}% учеников были на тренировке`
                : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Активны за месяц"
            value={stats?.activity.activeMembers30d}
            subtitle={
              stats && stats.counts.members > 0
                ? `${Math.round(
                    (stats.activity.activeMembers30d / stats.counts.members) *
                      100,
                  )}% учеников были на тренировке`
                : undefined
            }
            loading={loading}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Занятия за неделю"
            value={stats?.attendance.sessions7d}
            subtitle={
              stats ? `${stats.attendance.sessions30d} за месяц` : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Отметок за неделю"
            value={stats?.attendance.checkins7d}
            subtitle={
              stats ? `${stats.attendance.checkins30d} за месяц` : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Уникальных за месяц"
            value={stats?.attendance.distinctAttendees30d}
            subtitle="учеников отметилось"
            loading={loading}
          />
        </div>
        {stats && <AttendanceTrend data={stats.attendance.trend} />}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Последние действия</h2>
          <Link
            href={`/workspace/${workspaceId}/audit`}
            className="text-xs text-primary hover:underline"
          >
            Открыть историю →
          </Link>
        </div>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-12 animate-pulse rounded-md border border-border bg-muted"
              />
            ))}
          </div>
        )}

        {!loading && stats && stats.recentEvents.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Событий пока нет.
          </p>
        )}

        {!loading && stats && stats.recentEvents.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {stats.recentEvents.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {ACTION_META[event.action]?.label ?? event.action}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatActor(event)}
                    {" · "}
                    {targetTypeLabel(event.targetType)}
                  </div>
                </div>
                <time className="text-xs text-muted-foreground">
                  {formatRelative(event.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Видео</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Видео"
            value={stats?.counts.videos}
            subtitle={
              stats ? `${stats.counts.videosReady} готово к просмотру` : undefined
            }
            loading={loading}
            href={`/workspace/${workspaceId}/videos`}
          />
          <StatCard
            label="Курсы"
            value={stats?.counts.courses}
            loading={loading}
            href={`/workspace/${workspaceId}/content`}
          />
          <StatCard
            label="Не готово"
            value={
              stats
                ? Math.max(0, stats.counts.videos - stats.counts.videosReady)
                : undefined
            }
            subtitle="в обработке или с ошибкой"
            loading={loading}
          />
          <StatCard
            label="Смотрели видео"
            value={stats?.activity.videoViewers7d}
            subtitle={
              stats ? `${stats.activity.videoViewers30d} за месяц` : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Досмотров за неделю"
            value={stats?.activity.completions7d}
            subtitle="видео отмечены просмотренными"
            loading={loading}
          />
        </div>
      </section>

      {leaderboard?.enabled && leaderboard.entries.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Топ по посещаемости за месяц</h2>
          <ol className="divide-y divide-border rounded-lg border border-border">
            {leaderboard.entries.slice(0, 10).map((entry) => (
              <li
                key={entry.userId}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 text-center font-semibold tabular-nums">
                    {MEDAL[entry.rank] ?? entry.rank}
                  </span>
                  <span className="truncate">{entry.name}</span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {entry.checkins} трен.
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Топ видео за неделю</h2>
          <Link
            href={`/workspace/${workspaceId}/videos`}
            className="text-xs text-primary hover:underline"
          >
            Все видео →
          </Link>
        </div>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="h-12 animate-pulse rounded-md border border-border bg-muted"
              />
            ))}
          </div>
        )}

        {!loading && stats && stats.topVideos7d.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            За последнюю неделю никто ничего не смотрел.
          </p>
        )}

        {!loading && stats && stats.topVideos7d.length > 0 && (
          <ol className="divide-y divide-border rounded-lg border border-border">
            {stats.topVideos7d.map((video, idx) => {
              const completionPct =
                video.viewers > 0
                  ? Math.round((video.completions / video.viewers) * 100)
                  : 0
              return (
                <li key={video.id} className="p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/workspace/${workspaceId}/videos/${video.id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      <span className="text-muted-foreground">
                        {idx + 1}.{" "}
                      </span>
                      {video.title}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                      <span>{video.viewers} зрит.</span>
                      <span>{completionPct}% досмотр</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

// Six-month revenue bars. Pure CSS — no chart lib. Heights are relative to the
// tallest month; a month with 0 keeps a hairline so the axis stays continuous.
const weekFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
})
const formatWeek = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return weekFmt.format(new Date(y, m - 1, d))
}

// Weekly check-ins over the last 8 weeks — matches the revenue trend so the
// dashboard's two charts read as one system.
function AttendanceTrend({ data }: { data: { week: string; checkins: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.checkins))
  const any = data.some((d) => d.checkins > 0)
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">
        Отметки по неделям
      </div>
      {!any ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          За последние 8 недель отметок не было.
        </p>
      ) : (
        <div className="flex h-32 items-end gap-2">
          {data.map((d) => (
            <div
              key={d.week}
              className="flex flex-1 flex-col items-center gap-1"
              title={`Неделя с ${formatWeek(d.week)}: ${d.checkins}`}
            >
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-primary/80 transition-all"
                  style={{
                    height: `${Math.max(2, Math.round((d.checkins / max) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {formatWeek(d.week)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RevenueTrend({
  data,
  currency,
}: {
  data: { month: string; revenue: number }[]
  currency: string | null
}) {
  const max = Math.max(1, ...data.map((d) => d.revenue))
  const hasSales = data.some((d) => d.revenue > 0)
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">
        Выручка по месяцам
      </div>
      {!hasSales ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Продаж за последние 6 месяцев не было.
        </p>
      ) : (
        <div className="flex h-32 items-end gap-2">
          {data.map((d) => (
            <div
              key={d.month}
              className="flex flex-1 flex-col items-center gap-1"
              title={`${formatMonth(d.month)}: ${formatMoney(d.revenue, currency)}`}
            >
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-primary/80 transition-all"
                  style={{
                    height: `${Math.max(2, Math.round((d.revenue / max) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {formatMonth(d.month)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Which tariffs drove the last 30 days of sales. Each row shows count + revenue
// with a proportional bar so the mix is scannable at a glance.
function PlanBreakdown({
  data,
  currency,
}: {
  data: { planId: string; planName: string; count: number; revenue: number }[]
  currency: string | null
}) {
  const max = Math.max(1, ...data.map((d) => d.revenue))
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">
        Тарифы за 30 дней
      </div>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Продаж за последние 30 дней не было.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.map((row) => (
            <li key={row.planId} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{row.planName}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {row.count}× · {formatMoney(row.revenue, currency)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/80"
                  style={{ width: `${Math.round((row.revenue / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const TONE_TEXT: Record<"default" | "warn" | "danger", string> = {
  default: "",
  warn: "text-amber-600 dark:text-amber-500",
  danger: "text-destructive",
}

function StatCard({
  label,
  value,
  subtitle,
  loading,
  href,
  tone = "default",
}: {
  label: string
  value: number | string | undefined
  subtitle?: string
  loading: boolean
  href?: string
  tone?: "default" | "warn" | "danger"
}) {
  const body = (
    <div className="space-y-1 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-3xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
        {loading ? (
          <span className="inline-block h-8 w-12 animate-pulse rounded bg-muted" />
        ) : (
          (value ?? 0)
        )}
      </div>
      {subtitle && (
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block transition hover:opacity-90">
        {body}
      </Link>
    )
  }
  return body
}
