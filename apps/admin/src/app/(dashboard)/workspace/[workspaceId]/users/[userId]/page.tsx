"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { getMemberProgress, type MemberProgress } from "../../../../../../shared/api/members"
import {
  ACTIVITY_CHIP,
  ACTIVITY_LABEL,
  computeActivity,
  formatRelativeDays,
} from "../../../../../../shared/lib/member-activity"

const formatName = (m: MemberProgress["member"]): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email
}

const formatPosition = (sec: number): string => {
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const formatAccessLabel = (iso: string | null): string => {
  if (!iso) return "Без ограничения"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Без ограничения"
  const expired = d < new Date()
  const fmt = d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return expired ? `Истёк ${fmt}` : `Доступ до ${fmt}`
}

export default function MemberProgressPage() {
  const params = useParams<{ workspaceId: string; userId: string }>()
  const workspaceId = params?.workspaceId
  const userId = params?.userId

  const [data, setData] = useState<MemberProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !userId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await getMemberProgress({ workspaceId, userId })
        if (cancelled) return
        setData(result)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось загрузить профиль ученика.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, userId])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted" />
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href={`/workspace/${workspaceId}/users`}
          className="text-sm text-primary hover:underline"
        >
          ← Все ученики
        </Link>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      </div>
    )
  }

  if (!data) return null

  const { member, summary, courses, recentActivity } = data
  const activity = computeActivity(summary.lastWatchedAt)
  const completedPct =
    summary.totalVideos > 0
      ? Math.min(
          100,
          Math.round((summary.completedCount / summary.totalVideos) * 100),
        )
      : 0
  const accessExpired =
    member.accessUntil !== null && new Date(member.accessUntil) < new Date()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/workspace/${workspaceId}/users`}
          className="text-xs text-primary hover:underline"
        >
          ← Все ученики
        </Link>
        <h1 className="text-2xl font-semibold">{formatName(member)}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{member.email}</span>
          <span>·</span>
          <span className="uppercase">{member.status}</span>
          <span>·</span>
          <span className="capitalize">{member.roleName}</span>
          <span>·</span>
          <span
            className={
              accessExpired
                ? "font-medium text-destructive"
                : member.accessUntil
                  ? "text-foreground"
                  : ""
            }
          >
            {formatAccessLabel(member.accessUntil)}
          </span>
          <span>·</span>
          <span>
            добавлен{" "}
            {new Date(member.createdAt).toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTIVITY_CHIP[activity]}`}
          >
            {ACTIVITY_LABEL[activity]}
          </span>
          {summary.lastWatchedAt && (
            <span className="text-sm text-muted-foreground">
              последняя активность {formatRelativeDays(summary.lastWatchedAt)}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Просмотрено
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {summary.completedCount}
              <span className="ml-2 text-base font-normal text-muted-foreground">
                из {summary.totalVideos}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${completedPct}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {completedPct}% курса
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              В процессе
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {summary.inProgressCount}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              открыты, но не досмотрены
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Последний урок
            </div>
            {summary.lastWatchedVideo ? (
              <Link
                href={`/workspace/${workspaceId}/videos/${summary.lastWatchedVideo.id}`}
                className="block truncate text-base font-medium text-foreground hover:underline"
                title={summary.lastWatchedVideo.title}
              >
                {summary.lastWatchedVideo.title}
              </Link>
            ) : (
              <div className="italic text-muted-foreground">
                ещё ничего не открывал
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Прогресс по курсам</h2>
        {courses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            В клубе пока нет курсов.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {courses.map((c) => {
              const pct =
                c.totalVideos > 0
                  ? Math.round((c.completedCount / c.totalVideos) * 100)
                  : 0
              return (
                <li key={c.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/workspace/${workspaceId}/content/courses/${c.id}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {c.title}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                      <span className="font-medium text-foreground">
                        {c.completedCount}/{c.totalVideos}
                      </span>
                      <span>{pct}%</span>
                      {c.inProgressCount > 0 && (
                        <span>{c.inProgressCount} в процессе</span>
                      )}
                    </div>
                  </div>
                  {c.totalVideos > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">История просмотров (20 последних)</h2>
        {recentActivity.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Активности ещё нет.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recentActivity.map((row) => (
              <li
                key={`${row.videoId}-${row.watchedAt}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <Link
                  href={`/workspace/${workspaceId}/videos/${row.videoId}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                  title={row.videoTitle}
                >
                  {row.videoTitle}
                </Link>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  {row.status === "watched" ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      Просмотрено
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                      На {formatPosition(row.position)}
                    </span>
                  )}
                  <span>{formatRelativeDays(row.watchedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
