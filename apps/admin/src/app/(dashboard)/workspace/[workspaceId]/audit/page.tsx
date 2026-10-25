"use client"

import { Activity } from "lucide-react"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  listAuditEvents,
  type AuditEvent,
} from "../../../../../shared/api/audit"
import { errorMessage } from "../../../../../shared/lib/error-message"
import {
  ACTION_CATEGORIES,
  ACTION_CATEGORY_LABELS,
  ACTION_META,
  type ActionMeta,
  formatActor,
  formatDate,
  formatRelative,
  parseMetadata,
  targetTypeLabel,
  TONE_CLASS,
} from "../../../../../features/audit/audit-meta"

export default function WorkspaceAuditPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState("")

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
          actionPrefix: category ? `${category}.` : undefined,
        })
        if (cancelled) return
        setEvents(response.data)
        setTotal(response.total)
      } catch (err) {
        if (cancelled) return
        setError(
          errorMessage(err, "Не удалось загрузить журнал."),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, page, perPage, category])

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, AuditEvent[]>()
    for (const event of events) {
      const date = new Date(event.createdAt)
      const key = date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      const list = groups.get(key) ?? []
      list.push(event)
      groups.set(key, list)
    }
    return Array.from(groups.entries())
  }, [events])

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">История изменений</h1>
          <p className="text-sm text-muted-foreground">
            Кто и что делал в клубе. Только владелец видит этот раздел.
          </p>
        </div>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value)
            setPage(1)
          }}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Фильтр по разделу"
        >
          <option value="">Все разделы</option>
          {ACTION_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {ACTION_CATEGORY_LABELS[cat] ?? cat}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {!loading && events.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
          <Activity className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Событий пока нет</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Здесь появятся записи когда тренер начнёт что-то делать в клубе.
          </p>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="space-y-6">
          {groupedByDay.map(([day, dayEvents]) => (
            <section key={day} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {day}
              </h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {dayEvents.map((event) => {
                  const meta =
                    ACTION_META[event.action] ??
                    ({
                      label: event.action,
                      icon: Activity,
                      tone: "zinc",
                    } as ActionMeta)
                  const Icon = meta.icon
                  const fields = parseMetadata(event.metadata)
                  const targetLabel = targetTypeLabel(event.targetType)
                  const relative = formatRelative(event.createdAt)
                  return (
                    <li
                      key={event.id}
                      className="flex gap-3 p-3 transition-colors hover:bg-muted/40"
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${TONE_CLASS[meta.tone]}`}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">
                            {meta.label}
                          </span>
                          <time
                            className="text-xs text-muted-foreground"
                            title={formatDate(event.createdAt)}
                          >
                            {relative ?? formatDate(event.createdAt)}
                          </time>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>{formatActor(event)}</span>
                          <span>·</span>
                          <span>
                            {targetLabel}
                            {event.targetLabel && (
                              <span className="ml-1 font-medium text-foreground">
                                «{event.targetLabel}»
                              </span>
                            )}
                          </span>
                        </div>
                        {fields.length > 0 && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
                            {fields.map(({ key, label, value }) => (
                              <span
                                key={key}
                                className="text-muted-foreground"
                              >
                                <span className="text-foreground/60">
                                  {label}:
                                </span>{" "}
                                <span className="font-medium text-foreground/90">
                                  {value}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

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
