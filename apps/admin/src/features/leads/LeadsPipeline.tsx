"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import { memberTabs } from "../../app/(dashboard)/workspace/[workspaceId]/sections"
import { downloadExport } from "../../shared/api/exports"
import { getTrialLink, listLeads, type Lead, type LeadsPage, type TrialLink } from "../../shared/api/leads"
import { invalidateReads } from "../../shared/api/read-cache"
import { getWorkspaceSettings } from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { isClubAdmin } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { SectionTabs } from "../../shared/workspace/section-tabs"
import { useRequestCounts } from "../requests/use-request-counts"
import { LeadCreateSheet } from "./LeadCreateSheet"
import { LeadSheet } from "./LeadSheet"
import {
  childLine,
  emptyText,
  ERASED_NAME,
  LEAD_SOURCES,
  LEAD_VIEWS,
  metaLine,
  parsePipelineSearch,
  pipelineSearch,
  SOURCE_LABEL,
  statusLine,
  VIEW_LABEL,
  viewCount,
  type PipelineState,
} from "./lead-view"
import { printTrialPoster, TRIAL_FORM_OFF } from "./trial-poster"

const PER_PAGE = 50
// The server's page cap: a reload of more than one page asks in these.
const MAX_PER_PAGE = 100
const ALL_SOURCES = "all"

// Rows already shown are not repeated when the pages shift between requests.
const appendNew = (shown: Lead[], next: Lead[]) => {
  const seen = new Set(shown.map((l) => l.id))
  return [...shown, ...next.filter((l) => !seen.has(l.id))]
}

/**
 * «Ученики → Пробные»: every trial request — the club page, the QR poster,
 * a call — from «новая» to «купил». «Нужно действие» (new requests and past
 * trials nobody marked) is the default view and the tab badge. A row opens
 * its panel (`?lead=`); a `leads` signal (the public form, another admin)
 * reloads the list.
 */
export function LeadsPipeline({ workspaceId }: { workspaceId: string }) {
  const membership = useMyMembership(workspaceId)
  const vocabulary = useVocabulary()
  const canAdmin = isClubAdmin(membership)
  const requests = useRequestCounts(workspaceId)
  // Read from window (not useSearchParams) to avoid a Suspense boundary.
  const [state, setState] = useState<PipelineState | null>(null)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState<LeadsPage | null>(null)
  const [rows, setRows] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [clubName, setClubName] = useState("")
  const [trialLink, setTrialLink] = useState<TrialLink | null>(null)
  const [creating, setCreating] = useState(false)
  // Rows on screen, so a reload doesn't fold «Показать ещё» back.
  const shown = useRef(0)
  // A response for an older filter is dropped.
  const loadSeq = useRef(0)

  useEffect(() => {
    const parsed = parsePipelineSearch(window.location.search)
    setState(parsed)
    setQuery(parsed.q)
  }, [])

  useEffect(() => {
    void getWorkspaceSettings({ workspaceId })
      .then((s) => setClubName(s.name))
      .catch(() => setClubName(""))
    // Why the public form is off (if it is): the line above the list.
    void getTrialLink({ workspaceId })
      .then(setTrialLink)
      .catch(() => setTrialLink(null))
  }, [workspaceId])

  const update = useCallback((patch: Partial<PipelineState>) => {
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      const url = new URL(window.location.href)
      url.search = pipelineSearch(next)
      window.history.replaceState(window.history.state, "", url)
      return next
    })
  }, [])

  // The search box writes the URL a moment after typing stops.
  useEffect(() => {
    if (!state || query.trim() === state.q) return
    const t = setTimeout(() => update({ q: query.trim() }), 300)
    return () => clearTimeout(t)
  }, [query, state, update])

  const view = state?.view ?? null
  const source = state?.source ?? null
  const q = state?.q ?? ""
  const ready = state !== null

  // (Re)loads the rows already shown (at least one page).
  const load = useCallback(async () => {
    if (!ready || !view) return
    const seq = ++loadSeq.current
    const wanted = Math.max(PER_PAGE, shown.current)
    const size = wanted <= PER_PAGE ? PER_PAGE : MAX_PER_PAGE
    const pages = Math.ceil(wanted / size)
    try {
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          listLeads({ workspaceId, view, source: source ?? undefined, q, curPage: i + 1, perPage: size }),
        ),
      )
      if (seq !== loadSeq.current) return
      const data = results.reduce<Lead[]>((acc, r) => appendNew(acc, r.data), [])
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
  }, [workspaceId, view, source, q, ready])

  useEffect(() => {
    if (!ready) return
    shown.current = 0
    setLoading(true)
    void load()
    // A new filter starts over; `load` changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  useWorkspaceRealtime(workspaceId, ["leads"], () => void load())

  // A write in the panel: the list and the shared badge count reload.
  const changed = () => {
    invalidateReads(`leads:${workspaceId}`)
    void load()
  }

  const more = async () => {
    if (loadingMore || !view) return
    setLoadingMore(true)
    try {
      const res = await listLeads({
        workspaceId,
        view,
        source: source ?? undefined,
        q,
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

  const printPoster = async () => {
    setNotice(await printTrialPoster({ workspaceId, workspaceName: clubName, session: vocabulary.session, canAdmin }))
  }

  const downloadCsv = async () => {
    setNotice(null)
    try {
      await downloadExport({ workspaceId, kind: "leads" })
    } catch (e) {
      setNotice(errorMessage(e, "Не удалось выгрузить CSV"))
    }
  }

  const onRowKey = (event: KeyboardEvent, lead: Lead) => {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      update({ lead: lead.id })
    }
  }

  const now = new Date()
  const counts = page?.counts
  const viewOption = (v: (typeof LEAD_VIEWS)[number]) => {
    const count = counts ? viewCount(v, counts) : null
    return count ? `${VIEW_LABEL[v]} · ${count}` : VIEW_LABEL[v]
  }

  return (
    <div className="max-w-5xl space-y-4">
      <SectionTabs
        title="Ученики"
        tabs={memberTabs}
        badges={{ "users-requests": requests?.counts.total, "users-trials": counts?.needsAction }}
      />

      {state && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-60">
            <Select value={state.view} onValueChange={(v) => update({ view: v as PipelineState["view"], lead: null })}>
              <SelectTrigger aria-label="Показать">
                <SelectValue>{viewOption(state.view)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LEAD_VIEWS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {viewOption(v)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select
              value={state.source ?? ALL_SOURCES}
              onValueChange={(v) =>
                update({ source: v === ALL_SOURCES ? null : (v as NonNullable<PipelineState["source"]>), lead: null })
              }
            >
              <SelectTrigger aria-label="Источник">
                <SelectValue>{state.source ? SOURCE_LABEL[state.source] : "Все источники"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SOURCES}>Все источники</SelectItem>
                {LEAD_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или телефон"
            aria-label="Поиск по заявкам"
            className="h-9 w-56"
          />
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" onClick={() => setCreating(true)}>
              Добавить заявку
            </Button>
            {canAdmin ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="icon" variant="ghost" aria-label="Ещё">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void printPoster()}>QR-плакат для записи на пробное</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void downloadCsv()}>Скачать CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              // A head coach has only the poster: a «⋯» with one item would hide it.
              <Button type="button" variant="outline" onClick={() => void printPoster()}>
                QR-плакат
              </Button>
            )}
          </div>
        </div>
      )}

      {trialLink?.missing && (
        <p className="text-sm text-muted-foreground">
          {canAdmin ? (
            <>
              {TRIAL_FORM_OFF[trialLink.missing]} —{" "}
              <Link href={`/workspace/${workspaceId}/settings`} className="text-primary underline-offset-4 hover:underline">
                Настройки → Профиль клуба
              </Link>
            </>
          ) : (
            "Форму на странице клуба включает администратор клуба"
          )}
        </p>
      )}

      {notice && <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">{notice}</p>}

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
        <PipelineSkeleton />
      ) : rows.length === 0 ? (
        error || !view ? null : (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {q || source ? "Ничего не найдено" : emptyText(view)}
          </p>
        )
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((lead) => {
            const child = childLine(lead)
            const erased = lead.anonymizedAt !== null
            return (
              <li key={lead.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Заявка: ${lead.name ?? ERASED_NAME}`}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => update({ lead: lead.id })}
                  onKeyDown={(e) => onRowKey(e, lead)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className={cn("font-medium", erased && "text-muted-foreground")}>
                        {lead.name ?? ERASED_NAME}
                      </span>
                      {child && <span className="text-muted-foreground"> · {child}</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{metaLine(lead)}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap text-right text-xs",
                      // What «Нужно действие» counts reads amber (server rule).
                      lead.needsAction ? "font-medium text-amber-600" : "text-muted-foreground",
                    )}
                  >
                    {statusLine(lead, now)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && page && rows.length < page.total && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? "Загружаем…" : "Показать ещё"}
          </Button>
        </div>
      )}

      <LeadSheet
        workspaceId={workspaceId}
        leadId={state?.lead ?? null}
        onClose={() => update({ lead: null })}
        onChanged={changed}
      />

      <LeadCreateSheet
        workspaceId={workspaceId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={(lead) => {
          setCreating(false)
          changed()
          update({ lead: lead.id })
        }}
        onOpenLead={(leadId) => {
          setCreating(false)
          update({ lead: leadId })
        }}
      />
    </div>
  )
}

function PipelineSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-muted" />
      ))}
    </div>
  )
}
