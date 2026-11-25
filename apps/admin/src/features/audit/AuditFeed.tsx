"use client"

import { Activity } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import type { AuditEvent } from "../../shared/api/audit"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"
import {
  actionMetaFor,
  formatActor,
  formatDate,
  formatRelative,
  parseMetadata,
  targetTypeLabel,
  TONE_CLASS,
  unknownActionMeta,
} from "./audit-meta"

const PER_PAGE = 50

export type AuditPage = { data: AuditEvent[]; total: number }

// One journal (the club's «История изменений», the federation's): events
// grouped by day, with paging. `load` is the endpoint (stable: a new one
// reloads); callers key the feed by `actionPrefix`, so a new filter starts
// again from the first page.
export function AuditFeed({
  load,
  actionPrefix,
  emptyHint,
}: {
  load: (p: { curPage: number; perPage: number; actionPrefix?: string }) => Promise<AuditPage>
  actionPrefix?: string
  emptyHint: string
}) {
  const vocabulary = useVocabulary()
  const actionMeta = useMemo(() => actionMetaFor(vocabulary), [vocabulary])
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const response = await load({ curPage: page, perPage: PER_PAGE, actionPrefix })
        if (cancelled) return
        setEvents(response.data)
        setTotal(response.total)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Не удалось загрузить журнал."))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load, page, actionPrefix])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, AuditEvent[]>()
    for (const event of events) {
      const key = new Date(event.createdAt).toLocaleDateString("ru-RU", {
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
    <>
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
          <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="space-y-6">
          {groupedByDay.map(([day, dayEvents]) => (
            <section key={day} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{day}</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {dayEvents.map((event) => {
                  const meta = actionMeta[event.action] ?? unknownActionMeta(event.action)
                  const Icon = meta.icon
                  const fields = parseMetadata(event.metadata, vocabulary)
                  const targetLabel = targetTypeLabel(event.targetType)
                  const relative = formatRelative(event.createdAt)
                  return (
                    <li key={event.id} className="flex gap-3 p-3 transition-colors hover:bg-muted/40">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${TONE_CLASS[meta.tone]}`}
                      >
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{meta.label}</span>
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
                            {fields.map(({ key, label, value }) =>
                              value ? (
                                <span key={key} className="text-muted-foreground">
                                  <span className="text-foreground/60">{label}:</span>{" "}
                                  <span className="font-medium text-foreground/90">{value}</span>
                                </span>
                              ) : (
                                // A fact without a value («Видео перемещено»).
                                <span key={key} className="text-foreground/60">
                                  {label}
                                </span>
                              ),
                            )}
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
    </>
  )
}
