"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import { memberTabs } from "../../app/(dashboard)/workspace/[workspaceId]/sections"
import { fetchMe, type Me } from "../../shared/api/me"
import { addWorkspaceMember } from "../../shared/api/members"
import {
  listOpenRequests,
  type OpenRequest,
  type OpenRequestsPage,
  type RequestKind,
} from "../../shared/api/requests"
import { peekCachedRead } from "../../shared/api/read-cache"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { SectionTabs } from "../../shared/workspace/section-tabs"
import {
  detailLine,
  emptyInboxText,
  guardiansLine,
  inboxSearch,
  kindFilterLabel,
  kindLabel,
  parseInboxSearch,
  waitingLabel,
  type InboxState,
} from "./request-view"
import { RequestSheet } from "./RequestSheet"

const PER_PAGE = 50
// The server's page cap: a reload of more than one page asks in these.
const MAX_PER_PAGE = 100
const ALL = "all"

// Rows already shown are not repeated when the pages shift between requests.
const appendNew = (shown: OpenRequest[], next: OpenRequest[]) => {
  const seen = new Set(shown.map((r) => r.id))
  return [...shown, ...next.filter((r) => !seen.has(r.id))]
}

/**
 * «Ученики → Заявки»: every request waiting for this viewer's decision —
 * join, freeze, personal session, video review — oldest first. A row opens
 * its side panel (`?request=`); a join row also accepts or declines in place.
 * The tab badge, the «Вид» counts and the list come from the same read, and
 * a `requests` signal (a decision here, in the app or by another admin)
 * reloads what is shown.
 */
export function RequestsInbox({ workspaceId }: { workspaceId: string }) {
  const vocabulary = useVocabulary()
  // Read from window (not useSearchParams) to avoid a Suspense boundary.
  const [state, setState] = useState<InboxState | null>(null)
  const [page, setPage] = useState<OpenRequestsPage | null>(null)
  const [rows, setRows] = useState<OpenRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The account the sidebar already read (kept a minute): known on the first pass.
  const [viewerId, setViewerId] = useState<string | null>(() => peekCachedRead<Me>("me")?.id ?? null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  // The join row's «Отклонить» opens the panel in decline mode.
  const [declineFromRow, setDeclineFromRow] = useState(false)
  // Rows on screen, so a reload doesn't fold «Показать ещё» back.
  const shown = useRef(0)
  // A response for an older filter is dropped.
  const loadSeq = useRef(0)

  useEffect(() => {
    setState(parseInboxSearch(window.location.search))
    void fetchMe()
      .then((me) => setViewerId(me.id))
      .catch(() => undefined)
  }, [])

  const update = useCallback((patch: Partial<InboxState>) => {
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      const url = new URL(window.location.href)
      url.search = inboxSearch(next)
      window.history.replaceState(window.history.state, "", url)
      return next
    })
  }, [])

  const kind = state?.kind ?? null
  const ready = state !== null

  // (Re)loads the rows already shown (at least one page).
  const load = useCallback(async () => {
    if (!ready) return
    const seq = ++loadSeq.current
    const wanted = Math.max(PER_PAGE, shown.current)
    const size = wanted <= PER_PAGE ? PER_PAGE : MAX_PER_PAGE
    const pages = Math.ceil(wanted / size)
    try {
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          listOpenRequests({ workspaceId, kind: kind ?? undefined, curPage: i + 1, perPage: size }),
        ),
      )
      if (seq !== loadSeq.current) return
      const data = results.reduce<OpenRequest[]>((acc, r) => appendNew(acc, r.data), [])
      setPage(results[results.length - 1])
      setRows(data)
      shown.current = data.length
      setError(null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(errorMessage(e, "Не удалось загрузить заявки"))
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
    // `state` is read through `kind`: opening a row doesn't reload.
  }, [workspaceId, kind, ready])

  useEffect(() => {
    if (!ready) return
    shown.current = 0
    setLoading(true)
    void load()
    // A new filter starts over; `load` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  useWorkspaceRealtime(workspaceId, ["requests"], () => void load())

  // A linked kind this viewer has no such requests of: the whole list.
  useEffect(() => {
    if (page && kind && !page.kinds.includes(kind)) update({ kind: null })
  }, [page, kind, update])

  const more = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listOpenRequests({
        workspaceId,
        kind: kind ?? undefined,
        curPage: Math.floor(rows.length / PER_PAGE) + 1,
        perPage: PER_PAGE,
      })
      const next = appendNew(rows, res.data)
      setPage(res)
      setRows(next)
      shown.current = next.length
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить заявки"))
    } finally {
      setLoadingMore(false)
    }
  }

  const open = (request: OpenRequest, decline = false) => {
    setDeclineFromRow(decline)
    update({ request: request.id })
  }

  const accept = async (request: OpenRequest) => {
    setAcceptingId(request.id)
    setError(null)
    try {
      // By id: works for a child profile a parent filed by code (no e-mail).
      await addWorkspaceMember({ workspaceId, data: { userId: request.requestId } })
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось принять заявку"))
    } finally {
      setAcceptingId(null)
    }
  }

  const onRowKey = (event: KeyboardEvent, request: OpenRequest) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      open(request)
    }
  }

  const now = new Date()
  const kinds = page?.kinds ?? []
  // «Заморозка · 2»: a filter option with what waits of that kind.
  const kindOption = (k: RequestKind) => {
    const count = page?.counts[k] ?? 0
    return count > 0 ? `${kindFilterLabel(k, vocabulary)} · ${count}` : kindFilterLabel(k, vocabulary)
  }
  const openRow = state?.request ? (rows.find((r) => r.id === state.request) ?? null) : null

  return (
    <div className="max-w-5xl space-y-4">
      <SectionTabs
        title="Ученики"
        tabs={memberTabs}
        badges={{ "users-requests": page?.counts.total }}
      />

      {page && kinds.length > 1 && (
        <div className="w-72">
          <Select
            value={kind ?? ALL}
            onValueChange={(v) => update({ kind: v === ALL ? null : (v as RequestKind), request: null })}
          >
            <SelectTrigger aria-label="Вид">
              <SelectValue>{kind ? kindOption(kind) : "Все"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все</SelectItem>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {kindOption(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
        <InboxSkeleton />
      ) : rows.length === 0 ? (
        error ? null : (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {emptyInboxText(kind)}
          </p>
        )
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => {
            const guardians = guardiansLine(r.member)
            const detail = detailLine(r, vocabulary, viewerId)
            return (
              <li key={r.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`${kindLabel(r.kind, vocabulary)}: ${r.member.name}`}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => open(r)}
                  onKeyDown={(e) => onRowKey(e, r)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{kindLabel(r.kind, vocabulary)}</p>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{r.member.name}</span>
                      {r.member.isDependent && (
                        <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
                          Ребёнок
                        </span>
                      )}
                    </div>
                    {guardians && <p className="truncate text-xs text-muted-foreground">{guardians}</p>}
                    {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
                  </div>
                  {r.kind === "join" && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={acceptingId !== null}
                        onClick={(e) => {
                          e.stopPropagation()
                          void accept(r)
                        }}
                      >
                        {acceptingId === r.id ? "Принимаем…" : "Принять"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={acceptingId === r.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          open(r, true)
                        }}
                      >
                        Отклонить
                      </Button>
                    </div>
                  )}
                  <span className="min-w-12 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums">
                    {waitingLabel(r.createdAt, now)}
                  </span>
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

      <RequestSheet
        workspaceId={workspaceId}
        requestId={state?.request ?? null}
        request={openRow}
        listLoaded={!loading && page !== null}
        viewerId={viewerId}
        startInDecline={declineFromRow}
        onClose={() => {
          setDeclineFromRow(false)
          update({ request: null })
        }}
        onChanged={() => void load()}
      />
    </div>
  )
}

function InboxSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-muted" />
      ))}
    </div>
  )
}
