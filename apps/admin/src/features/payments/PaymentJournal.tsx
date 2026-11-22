"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { AnalyticsFilters } from "../../app/(dashboard)/workspace/[workspaceId]/analytics/analytics-toolbar"
import { listDiscounts, type Discount } from "../../shared/api/discounts"
import { downloadExport } from "../../shared/api/exports"
import { listAllStaffMembers, type WorkspaceMember } from "../../shared/api/members"
import {
  listPaymentJournal,
  type JournalKind,
  type JournalMethod,
  type PaymentJournalEntry,
  type PaymentJournalPage,
  type PaymentJournalUnapplied,
} from "../../shared/api/payment-journal"
import { getWorkspaceSettings } from "../../shared/api/workspaces"
import { EMPTY_ANALYTICS_FILTER } from "../../shared/lib/analytics"
import { errorMessage } from "../../shared/lib/error-message"
import { useThrottledCallback } from "../../shared/lib/throttle"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { formatAmount } from "../subscriptions/subscription-display"
import { formatMemberLabel } from "../groups/helpers"
import {
  JOURNAL_KINDS,
  JOURNAL_METHODS,
  JOURNAL_Q_MAX,
  KIND_LABEL,
  clubToday,
  discountsLine,
  emptyText,
  entryAmount,
  entryDiscountNote,
  entryMethodLabel,
  entryWhat,
  formatEntryAt,
  journalFilters,
  journalSearch,
  methodLabel,
  methodsLine,
  panelFilterCount,
  parseJournalSearch,
  refundedNote,
  summaryLine,
  unappliedTitle,
  type JournalState,
} from "./journal-view"
import { PaymentEntrySheet } from "./PaymentEntrySheet"
import { PeriodPicker } from "./PeriodPicker"

const PER_PAGE = 50
// The server's page cap: a refresh reloads everything already shown.
const MAX_PER_PAGE = 200
// A mark or a refund arrives live; the list re-reads at most this often.
const REFRESH_MS = 5_000
const ALL = "all"
const NOBODY = "all"
// «Скидка»: any discount (named or one-off).
const DISCOUNTED = "discounted"

// Rows already shown are not repeated when the pages shift between requests.
const appendNew = (shown: PaymentJournalEntry[], next: PaymentJournalEntry[]) => {
  const seen = new Set(shown.map((r) => r.id))
  return [...shown, ...next.filter((r) => !seen.has(r.id))]
}

/**
 * «Абонементы → Платежи»: every payment of a period — abonements and event
 * tickets, cash, transfer, card at the club and online — and every refund of
 * them, newest first, with the period's totals per method. The default period is the dashboard's
 * «Выручка за 30 дней» window, so the two numbers agree. The URL holds the
 * view; a row opens its details in a side panel (`?entry=`).
 */
export function PaymentJournal({ workspaceId }: { workspaceId: string }) {
  const vocabulary = useVocabulary()
  // Read from window (not useSearchParams) to avoid a Suspense boundary.
  const [state, setState] = useState<JournalState | null>(null)
  const [timezone, setTimezone] = useState<string | null>(null)
  const [page, setPage] = useState<PaymentJournalPage | null>(null)
  const [rows, setRows] = useState<PaymentJournalEntry[]>([])
  const [unapplied, setUnapplied] = useState<PaymentJournalPage["unapplied"]>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qInput, setQInput] = useState("")
  const [discounts, setDiscounts] = useState<Discount[] | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [staff, setStaff] = useState<WorkspaceMember[] | null>(null)
  const [openUnapplied, setOpenUnapplied] = useState<PaymentJournalUnapplied | null>(null)
  // Rows on screen, so a refresh doesn't fold «Показать ещё» back.
  const shown = useRef(0)

  useEffect(() => {
    const parsed = parseJournalSearch(window.location.search)
    setState(parsed)
    setQInput(parsed.q)
  }, [])

  useEffect(() => {
    void getWorkspaceSettings({ workspaceId })
      .then((s) => setTimezone(s.timezone))
      .catch(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone))
  }, [workspaceId])

  const update = useCallback((patch: Partial<JournalState>) => {
    setState((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      const url = new URL(window.location.href)
      url.search = journalSearch(next)
      window.history.replaceState(window.history.state, "", url)
      return next
    })
  }, [])

  // The open row is not a filter: opening it doesn't reload the list.
  const filtersKey = state ? journalSearch({ ...state, entry: null }) : null

  const load = useCallback(async () => {
    if (!state) return
    try {
      const res = await listPaymentJournal({
        workspaceId,
        ...journalFilters(state),
        perPage: Math.min(MAX_PER_PAGE, Math.max(PER_PAGE, shown.current)),
      })
      setPage(res)
      setRows(res.data)
      setUnapplied(res.unapplied)
      shown.current = res.data.length
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить платежи"))
    } finally {
      setLoading(false)
    }
    // `state` is read through `filtersKey`: the open row doesn't reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, filtersKey])

  useEffect(() => {
    if (filtersKey === null) return
    shown.current = 0
    setLoading(true)
    void load()
  }, [load, filtersKey])

  const refresh = useThrottledCallback(() => void load(), REFRESH_MS)
  useWorkspaceRealtime(workspaceId, ["payments"], refresh)

  // The search box narrows the list a moment after typing stops.
  useEffect(() => {
    if (!state || qInput.trim() === state.q.trim()) return
    const handle = setTimeout(() => update({ q: qInput.trim() }), 250)
    return () => clearTimeout(handle)
  }, [qInput, state, update])

  const more = async () => {
    if (!state || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await listPaymentJournal({
        workspaceId,
        ...journalFilters(state),
        curPage: Math.floor(rows.length / PER_PAGE) + 1,
        perPage: PER_PAGE,
      })
      const next = appendNew(rows, res.data)
      setPage(res)
      setRows(next)
      shown.current = next.length
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить платежи"))
    } finally {
      setLoadingMore(false)
    }
  }

  const openFilters = () => {
    setFiltersOpen(true)
    if (staff === null) {
      void listAllStaffMembers({ workspaceId })
        .then(setStaff)
        .catch(() => setStaff([]))
    }
    // «Скидка» lists every discount by name, archived ones too.
    if (discounts === null) {
      void listDiscounts({ workspaceId, archived: true })
        .then((r) => setDiscounts(r.data))
        .catch(() => setDiscounts([]))
    }
  }

  const exportCsv = async () => {
    if (!state) return
    setExporting(true)
    try {
      await downloadExport({ workspaceId, kind: "payments", query: journalFilters(state) })
    } catch (e) {
      setError(errorMessage(e, "Не удалось выгрузить платежи"))
    } finally {
      setExporting(false)
    }
  }

  if (!state || !timezone) return <JournalSkeleton />

  const today = clubToday(timezone)
  const filterCount = panelFilterCount(state)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <PeriodPicker
          id="journal"
          value={state}
          today={today}
          onChange={(range) => update(range)}
        />
        <div className="w-44">
          <Select
            value={state.method ?? ALL}
            onValueChange={(v) => update({ method: v === ALL ? null : (v as JournalMethod) })}
          >
            <SelectTrigger aria-label="Способ">
              <SelectValue placeholder="Способ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все способы</SelectItem>
              {JOURNAL_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {methodLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          type="search"
          value={qInput}
          maxLength={JOURNAL_Q_MAX}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Найти ученика"
          aria-label="Найти ученика"
          className="h-9 w-56"
        />
        <Button type="button" variant="outline" className="h-9" onClick={openFilters}>
          {filterCount > 0 ? `Фильтры · ${filterCount}` : "Фильтры"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="ml-auto h-9"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          {exporting ? "Готовим…" : "Скачать CSV"}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && page && page.totals.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border bg-card p-4" aria-label="Итоги">
          {page.totals.map((t) => {
            const line = summaryLine(t)
            const methods = methodsLine(t)
            const given = discountsLine(t)
            return (
              <div key={t.currency} className="space-y-0.5">
                <p className="text-sm">
                  {line.before}
                  <span className="text-base font-semibold tabular-nums">{line.net}</span>
                </p>
                {methods && <p className="text-sm text-muted-foreground">{methods}</p>}
                {given && <p className="text-sm text-muted-foreground">{given}</p>}
              </div>
            )
          })}
        </div>
      )}

      {!loading && unapplied && unapplied.total > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-amber-700">{unappliedTitle(unapplied.total)}</h2>
          <ul className="divide-y divide-border rounded-lg border border-amber-600/30 bg-amber-50/40">
            {unapplied.data.map((u) => (
              <li key={u.paymentId}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left transition hover:bg-muted"
                  onClick={() => setOpenUnapplied(u)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {u.member.name}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {formatEntryAt(u.at, timezone)} · {u.itemName}
                      </span>
                    </div>
                    <div className="text-xs text-amber-700">{u.activationError}</div>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatAmount(u.amount, u.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading ? (
        <JournalSkeleton />
      ) : rows.length === 0 ? (
        error ? null : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {emptyText(state)}
          </p>
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-normal">Дата</th>
                <th className="p-3 font-normal">Ученик</th>
                <th className="p-3 font-normal">Способ</th>
                <th className="p-3 font-normal">Отметил</th>
                <th className="p-3 text-right font-normal">Сумма</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((e) => {
                const refunded = refundedNote(e)
                const discount = entryDiscountNote(e)
                return (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    aria-label={`${e.member.name}, ${entryAmount(e)}`}
                    className="cursor-pointer align-top transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => update({ entry: e.id })}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault()
                        update({ entry: e.id })
                      }
                    }}
                  >
                    <td className="whitespace-nowrap p-3 tabular-nums">
                      {formatEntryAt(e.at, timezone)}
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{e.member.name}</div>
                      <div className="text-xs text-muted-foreground">{entryWhat(e)}</div>
                    </td>
                    <td className="whitespace-nowrap p-3">{entryMethodLabel(e)}</td>
                    <td className="p-3">{e.markedBy?.name ?? "—"}</td>
                    <td className="whitespace-nowrap p-3 text-right">
                      <div
                        className={`font-medium tabular-nums ${e.kind === "refund" ? "text-destructive" : ""}`}
                      >
                        {entryAmount(e)}
                      </div>
                      {refunded && <div className="text-xs text-muted-foreground">{refunded}</div>}
                      {discount && (
                        <div className="ml-auto max-w-64 whitespace-normal text-xs text-muted-foreground">
                          {discount}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent className="flex w-full flex-col gap-6 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Фильтры</SheetTitle>
            <SheetDescription>
              Зал, направление, группа и {vocabulary.coach.nom} оставляют оплаты учеников этих
              групп.
            </SheetDescription>
          </SheetHeader>
          {/* One picker per line: the shared bar wraps unevenly in a narrow panel. */}
          <div className="[&>div]:flex-col [&>div]:items-start">
            <AnalyticsFilters
              workspaceId={workspaceId}
              value={state.scope}
              onChange={(scope) => update({ scope })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Отметил</Label>
            <div className="w-48">
              <Select
                value={state.markedById ?? NOBODY}
                onValueChange={(v) => update({ markedById: v === NOBODY ? null : v })}
              >
                <SelectTrigger aria-label="Отметил">
                  <SelectValue placeholder="Отметил" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOBODY}>Все сотрудники</SelectItem>
                  {(staff ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {formatMemberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Скидка</Label>
            <div className="w-48">
              <Select
                value={state.discountId ?? (state.discounted ? DISCOUNTED : ALL)}
                onValueChange={(v) =>
                  update({
                    discounted: v === DISCOUNTED,
                    discountId: v === ALL || v === DISCOUNTED ? null : v,
                  })
                }
              >
                <SelectTrigger aria-label="Скидка">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все оплаты</SelectItem>
                  <SelectItem value={DISCOUNTED}>Со скидкой</SelectItem>
                  {(discounts ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.isActive ? d.name : `${d.name} · в архиве`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Дал скидку</Label>
            <div className="w-48">
              <Select
                value={state.pricedById ?? NOBODY}
                onValueChange={(v) => update({ pricedById: v === NOBODY ? null : v })}
              >
                <SelectTrigger aria-label="Дал скидку">
                  <SelectValue placeholder="Дал скидку" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOBODY}>Все сотрудники</SelectItem>
                  {(staff ?? []).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {formatMemberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Показывать</Label>
            <div className="w-48">
              <Select
                value={state.kind ?? "all"}
                onValueChange={(v) =>
                  update({ kind: v === "all" ? null : (v as Exclude<JournalKind, "all">) })
                }
              >
                <SelectTrigger aria-label="Показывать">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOURNAL_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {filterCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() =>
                update({
                  scope: EMPTY_ANALYTICS_FILTER,
                  markedById: null,
                  kind: null,
                  discounted: false,
                  discountId: null,
                  pricedById: null,
                })
              }
            >
              Сбросить фильтры
            </Button>
          )}
        </SheetContent>
      </Sheet>

      <PaymentEntrySheet
        workspaceId={workspaceId}
        timezone={timezone}
        entryId={state.entry}
        unapplied={openUnapplied}
        onClose={() => {
          setOpenUnapplied(null)
          update({ entry: null })
        }}
        onChanged={() => void load()}
      />
    </div>
  )
}

function JournalSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-muted" />
      ))}
    </div>
  )
}
