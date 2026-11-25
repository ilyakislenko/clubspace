"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { memberTabs } from "../../app/(dashboard)/workspace/[workspaceId]/sections"
import {
  listClubMessages,
  type ClubMessage,
  type ClubMessagesPage,
} from "../../shared/api/messages"
import { errorMessage } from "../../shared/lib/error-message"
import { isSportLead } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { SectionTabs } from "../../shared/workspace/section-tabs"
import { useRequestCounts } from "../requests/use-request-counts"
import { ComposeMessageSheet, type ComposePrefill } from "./ComposeMessageSheet"
import { MessageDetailSheet } from "./MessageDetailSheet"
import { flagsText, readLine, segmentLabel, statusLabel, type Segment } from "./message-view"

const PER_PAGE = 50
// The server's page cap: a reload of more than one page asks in these.
const MAX_PER_PAGE = 200

type UrlState = {
  // ?message=: the open message.
  message: string | null
  // ?compose=1: the compose panel; ?segment= prefills it (the roster and the
  // retention lists link here).
  compose: boolean
  segment: Segment | null
  // ?userId=: only what this student received (the member card's «Все»).
  userId: string | null
}

const PREFILLABLE: readonly Segment[] = ["RENEW", "UNPAID", "INACTIVE", "CALL_LIST"]

const parseUrl = (search: string): UrlState => {
  const q = new URLSearchParams(search)
  const segment = q.get("segment")
  return {
    message: q.get("message"),
    compose: q.get("compose") === "1",
    segment: PREFILLABLE.find((s) => s === segment) ?? null,
    userId: q.get("userId"),
  }
}

const writeUrl = (state: UrlState) => {
  const url = new URL(window.location.href)
  const set = (key: string, value: string | null) =>
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key)
  set("message", state.message)
  set("compose", state.compose ? "1" : null)
  set("segment", state.compose ? state.segment : null)
  set("userId", state.userId)
  window.history.replaceState(window.history.state, "", url)
}

// Rows already shown are not repeated when the pages shift between requests.
const appendNew = (shown: ClubMessage[], next: ClubMessage[]) => {
  const seen = new Set(shown.map((m) => m.id))
  return [...shown, ...next.filter((m) => !seen.has(m.id))]
}

/**
 * «Ученики → Сообщения»: what the club sent to students, newest first —
 * sport leads see every message, other staff their own. One primary
 * «Написать»; a row opens its panel with who got it and who opened it.
 * A `messages` signal (a send, a read, the dispatcher) reloads the list.
 */
export function MessagesPage({ workspaceId }: { workspaceId: string }) {
  const membership = useMyMembership(workspaceId)
  const lead = isSportLead(membership)
  const requests = useRequestCounts(workspaceId)
  const [state, setState] = useState<UrlState | null>(null)
  const [page, setPage] = useState<ClubMessagesPage | null>(null)
  const [rows, setRows] = useState<ClubMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = useRef(0)
  const loadSeq = useRef(0)

  useEffect(() => setState(parseUrl(window.location.search)), [])

  const update = useCallback((patch: Partial<UrlState>) => {
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      writeUrl(next)
      return next
    })
  }, [])

  const userId = state?.userId ?? null
  const ready = state !== null

  const load = useCallback(async () => {
    if (!ready) return
    const seq = ++loadSeq.current
    const perPage = Math.min(MAX_PER_PAGE, Math.max(PER_PAGE, shown.current))
    try {
      const res = await listClubMessages({ workspaceId, userId: userId ?? undefined, perPage })
      if (seq !== loadSeq.current) return
      setPage(res)
      setRows(res.data)
      shown.current = res.data.length
      setError(null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(errorMessage(e, "Не удалось загрузить сообщения"))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [workspaceId, userId, ready])

  useEffect(() => {
    shown.current = 0
    setLoading(true)
    void load()
  }, [load])

  useWorkspaceRealtime(workspaceId, ["messages"], () => void load())

  const more = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listClubMessages({
        workspaceId,
        userId: userId ?? undefined,
        curPage: Math.floor(rows.length / PER_PAGE) + 1,
        perPage: PER_PAGE,
      })
      const next = appendNew(rows, res.data)
      setPage(res)
      setRows(next)
      shown.current = next.length
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить сообщения"))
    } finally {
      setLoadingMore(false)
    }
  }

  const onRowKey = (event: KeyboardEvent, m: ClubMessage) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      update({ message: m.id })
    }
  }

  const viewer = { isSportLead: lead, isDirectionManager: false }
  const prefill: ComposePrefill | null = state?.segment
    ? { segment: state.segment, label: segmentLabel(state.segment, viewer) }
    : null
  const tz = page?.timezone ?? "UTC"
  const now = new Date()

  return (
    <div className="max-w-5xl space-y-4">
      <SectionTabs
        title="Ученики"
        tabs={memberTabs}
        badges={{ "users-requests": requests?.counts.total }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {userId && (
          <p className="text-sm text-muted-foreground">
            Сообщения одному ученику ·{" "}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => update({ userId: null })}
            >
              все сообщения
            </button>
          </p>
        )}
        <Button
          type="button"
          className="ml-auto"
          onClick={() => update({ compose: true, segment: null })}
        >
          Написать
        </Button>
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          {rows.length === 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true)
                void load()
              }}
            >
              Повторить
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        error ? null : (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {userId
              ? "Этому ученику сообщений не было."
              : "Сообщений пока нет. «Написать» — всем ученикам, группе, тем, кому пора продлить, или одному ученику."}
          </p>
        )
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((m) => {
            const flags = flagsText(m)
            const read = readLine(m)
            return (
              <li key={m.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={m.title}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => update({ message: m.id })}
                  onKeyDown={(e) => onRowKey(e, m)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{m.title}</span>
                      {flags && (
                        <span
                          title={flags}
                          aria-label={flags}
                          className={`size-2 shrink-0 rounded-full ${
                            m.isService ? "bg-amber-500" : m.urgent ? "bg-destructive" : "bg-sky-500"
                          }`}
                        />
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {lead ? `${m.audienceLabel} · ${m.authorName}` : m.audienceLabel}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums">
                    <p
                      className={
                        m.status === "SCHEDULED" ? "text-foreground" : "text-muted-foreground"
                      }
                    >
                      {statusLabel(m, tz, now)}
                    </p>
                    {read && <p className="text-muted-foreground">{read}</p>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && page && rows.length < page.total && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void more()}
          >
            {loadingMore ? "Загружаем…" : "Показать ещё"}
          </Button>
        </div>
      )}

      <MessageDetailSheet
        workspaceId={workspaceId}
        messageId={state?.message ?? null}
        timezone={tz}
        onClose={() => update({ message: null })}
        onChanged={() => void load()}
      />
      <ComposeMessageSheet
        workspaceId={workspaceId}
        open={state?.compose ?? false}
        prefill={prefill}
        onClose={() => update({ compose: false, segment: null })}
        onSent={() => void load()}
      />
    </div>
  )
}
