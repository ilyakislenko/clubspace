"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import {
  getWorkspaceStats,
  type WorkspaceStats,
} from "../../../../shared/api/stats"

const ACTION_LABELS: Record<string, string> = {
  "video.upload.create": "Создан upload видео",
  "video.upload.complete": "Завершён upload видео",
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

export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const data = await getWorkspaceStats({ workspaceId })
        if (cancelled) return
        setStats(data)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось загрузить статистику.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId])

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

function StatCard({
  label,
  value,
  subtitle,
  loading,
  href,
}: {
  label: string
  value: number | undefined
  subtitle?: string
  loading: boolean
  href?: string
}) {
  const body = (
    <div className="space-y-1 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-3xl font-semibold tabular-nums">
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
