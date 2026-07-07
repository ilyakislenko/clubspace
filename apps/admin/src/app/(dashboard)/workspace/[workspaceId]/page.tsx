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
import { errorMessage } from "../../../../shared/lib/error-message"

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" }

const ACTION_LABELS: Record<string, string> = {
  "video.startUpload": "Создан upload видео",
  "video.completeUpload": "Завершён upload видео",
  "video.update": "Видео обновлено",
  "video.delete": "Видео удалено",
  "playlist.create": "Курс создан",
  "playlist.update": "Курс обновлён",
  "playlist.delete": "Курс удалён",
  "member.add": "Участник добавлен",
  "member.remove": "Участник удалён",
}

const formatRelative = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "только что"
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} мин назад`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} ч назад`
  return `${Math.floor(ms / 86_400_000)} дн назад`
}

const numberFmt = new Intl.NumberFormat("ru-RU")
const formatMoney = (amount: number, currency: string | null) =>
  currency ? `${numberFmt.format(amount)} ${currency}` : numberFmt.format(amount)

export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
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
    ])
  }, [workspaceId])

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
    () => void load(),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Дэшборд</h1>
        <p className="text-sm text-muted-foreground">Обзор клуба.</p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="Участники"
          value={stats?.counts.members}
          loading={loading}
          href={`/workspace/${workspaceId}/users`}
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Активны за неделю"
          value={stats?.activity.activeMembers7d}
          subtitle={
            stats && stats.counts.members > 0
              ? `${Math.round(
                  (stats.activity.activeMembers7d / stats.counts.members) * 100,
                )}% от всех учеников`
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
                )}% от всех учеников`
              : undefined
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

      {stats?.revenue && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Финансы</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="MRR (оценка)"
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
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Посещаемость</h2>
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
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Удержание</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Неактивны за месяц"
            value={stats?.retention.inactiveMembers30d}
            subtitle="без отметок 30 дней"
            loading={loading}
            tone="warn"
            href={`/workspace/${workspaceId}/users`}
          />
          <StatCard
            label="Доступ истекает"
            value={stats?.retention.expiringSoon}
            subtitle="в ближайшие 14 дней"
            loading={loading}
            tone="warn"
          />
          <StatCard
            label="Доступ закончился"
            value={stats?.retention.expiredAccess}
            subtitle="требуют продления"
            loading={loading}
            tone="danger"
            href={`/workspace/${workspaceId}/users`}
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

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Последние события</h2>
          <Link
            href={`/workspace/${workspaceId}/audit`}
            className="text-xs text-primary hover:underline"
          >
            Открыть журнал →
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
                    {ACTION_LABELS[event.action] ?? event.action}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {event.actorEmail ?? "system"}
                    {event.targetId && (
                      <>
                        {" · "}
                        <span className="font-mono">
                          {event.targetType}:{event.targetId.slice(0, 8)}…
                        </span>
                      </>
                    )}
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
