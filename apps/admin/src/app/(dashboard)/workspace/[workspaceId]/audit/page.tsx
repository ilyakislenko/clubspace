"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import {
  listAuditEvents,
  type AuditEvent,
} from "../../../../../shared/api/audit"

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

const formatDate = (iso: string) => {
  const date = new Date(iso)
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

const renderMetadata = (metadata: unknown) => {
  if (metadata === null || metadata === undefined) return null
  if (typeof metadata === "string" && metadata.trim() === "") return null
  try {
    const json = JSON.stringify(metadata, null, 0)
    if (json === "null" || json === "{}") return null
    return json
  } catch {
    return null
  }
}

export default function WorkspaceAuditPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const response = await listAuditEvents({
          workspaceId,
          curPage: page,
          perPage,
        })
        if (cancelled) return
        setEvents(response.data)
        setTotal(response.total)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось загрузить журнал.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, page, perPage])

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Журнал событий</h1>
        <p className="text-sm text-muted-foreground">
          Кто и что делал в клубе. Только владелец видит этот раздел.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-14 animate-pulse rounded-md border border-border bg-muted"
              />
            ))}
          </div>
        )}

        {!loading && events.length === 0 && !error && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Событий пока нет.
          </p>
        )}

        {!loading && events.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {events.map((event) => {
              const metadata = renderMetadata(event.metadata)
              return (
                <li key={event.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {ACTION_LABELS[event.action] ?? event.action}
                    </span>
                    <time className="text-xs text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </time>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {event.actorEmail ? (
                      <span>{event.actorEmail}</span>
                    ) : event.actorId ? (
                      <span>actor: {event.actorId.slice(0, 8)}…</span>
                    ) : (
                      <span>actor: system</span>
                    )}
                    <span>·</span>
                    <span>{event.targetType}</span>
                    {event.targetId && (
                      <>
                        <span>·</span>
                        <span className="font-mono">
                          {event.targetId.slice(0, 8)}…
                        </span>
                      </>
                    )}
                  </div>
                  {metadata && (
                    <pre className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                      {metadata}
                    </pre>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            Страница {page} из {totalPages} · всего {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              ← Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Вперёд →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
