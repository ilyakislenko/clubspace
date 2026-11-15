"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import { listDiscounts, type Discount, type DiscountList as DiscountPage } from "../../shared/api/discounts"
import { listPlans, type Plan } from "../../shared/api/subscriptions"
import { getWorkspaceSettings } from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { useThrottledCallback } from "../../shared/lib/throttle"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { EMPTY_JOURNAL_STATE, clubToday, journalSearch } from "../payments/journal-view"
import { PeriodPicker } from "../payments/PeriodPicker"
import {
  DISCOUNT_STATUS_LABEL,
  discountDatesText,
  discountHowText,
  discountScopeText,
  discountSizeText,
  discountUsageText,
  staffDiscountLine,
} from "./discount-view"
import { DiscountFormSheet } from "./DiscountFormSheet"

// A sale or a payment arrives live; the list re-reads at most this often.
const REFRESH_MS = 5_000

type View = {
  archived: boolean
  // Club-local days of «Кто давал скидки»; neither = 30 days.
  from: string | null
  to: string | null
}

// The panel: an existing discount (`?discount=<id>`) or a new one (`?new=1`).
type Panel = { kind: "edit"; id: string } | { kind: "new" } | null

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

const readUrl = (): { view: View; panel: Panel } => {
  const p = new URLSearchParams(window.location.search)
  const from = p.get("from")
  const to = p.get("to")
  const datesOk = !!from && !!to && YMD_RE.test(from) && YMD_RE.test(to) && from <= to
  const id = p.get("discount")
  return {
    view: {
      archived: p.get("archived") === "1",
      from: datesOk ? from : null,
      to: datesOk ? to : null,
    },
    panel: id ? { kind: "edit", id } : p.has("new") ? { kind: "new" } : null,
  }
}

const writeUrl = (view: View, panel: Panel) => {
  const p = new URLSearchParams()
  if (view.archived) p.set("archived", "1")
  if (view.from && view.to) {
    p.set("from", view.from)
    p.set("to", view.to)
  }
  if (panel?.kind === "edit") p.set("discount", panel.id)
  if (panel?.kind === "new") p.set("new", "1")
  const url = new URL(window.location.href)
  url.search = p.toString()
  window.history.replaceState(window.history.state, "", url)
}

/**
 * «Абонементы → Скидки» (club admins): the club's discounts — chosen by staff
 * at a sale, entered as a promo code, or the automatic family one — with how
 * often each was used, and «Кто давал скидки»: what each staff member took
 * off the list price in a period, linked to those payments in «Платежи». A
 * row opens the discount in a side panel; the URL holds the view.
 */
export function DiscountList({ workspaceId }: { workspaceId: string }) {
  const [view, setView] = useState<View | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [timezone, setTimezone] = useState<string | null>(null)
  const [page, setPage] = useState<DiscountPage | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const parsed = readUrl()
    setView(parsed.view)
    setPanel(parsed.panel)
  }, [])

  useEffect(() => {
    void getWorkspaceSettings({ workspaceId })
      .then((s) => setTimezone(s.timezone))
      .catch(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone))
    // The tariffs a discount may cover (archived ones too: a discount may
    // still name one).
    void listPlans({ workspaceId, includeInactive: true })
      .then((r) => setPlans(r.data))
      .catch(() => setPlans([]))
  }, [workspaceId])

  const load = useCallback(async () => {
    if (!view) return
    try {
      setPage(
        await listDiscounts({
          workspaceId,
          archived: view.archived,
          from: view.from ?? undefined,
          to: view.to ?? undefined,
        }),
      )
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить скидки"))
    }
  }, [workspaceId, view])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useThrottledCallback(() => void load(), REFRESH_MS)
  useWorkspaceRealtime(workspaceId, ["discounts", "payments"], refresh)

  const changeView = (patch: Partial<View>) => {
    if (!view) return
    const next = { ...view, ...patch }
    setView(next)
    writeUrl(next, panel)
  }

  const openPanel = (next: Panel) => {
    setPanel(next)
    if (view) writeUrl(view, next)
  }

  if (!view || !timezone) return <ListSkeleton />

  const today = clubToday(timezone)
  const discounts = page?.data ?? []
  const byStaff = page?.byStaff ?? []
  const editing =
    panel?.kind === "edit" ? (discounts.find((d) => d.id === panel.id) ?? null) : null
  // The family option is closed while another family discount is active.
  const activeFamily = discounts.find((d) => d.isFamily && d.isActive) ?? null
  const staffHref = (userId: string) =>
    `/workspace/${workspaceId}/subscriptions/payments${journalSearch({
      ...EMPTY_JOURNAL_STATE,
      from: view.from,
      to: view.to,
      discounted: true,
      pricedById: userId,
    })}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => changeView({ archived: !view.archived })}
        >
          {view.archived ? "Скрыть архив" : "Показать архив"}
        </button>
        <Button type="button" onClick={() => openPanel({ kind: "new" })}>
          Новая скидка
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!page ? (
        error ? null : <ListSkeleton />
      ) : discounts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Скидок пока нет — создайте первую, например семейную
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-normal">Скидка</th>
                <th className="p-3 font-normal">Размер</th>
                <th className="p-3 font-normal">На что</th>
                <th className="p-3 font-normal">Использование</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {discounts.map((d) => (
                <DiscountRow
                  key={d.id}
                  discount={d}
                  today={today}
                  onOpen={() => openPanel({ kind: "edit", id: d.id })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Shown once anyone gave a discount; a picked period keeps it (and its
          select) on screen while that period has none. */}
      {page && (byStaff.length > 0 || view.from !== null) && (
        <section className="space-y-3" aria-label="Кто давал скидки">
          <div className="flex flex-wrap items-end gap-3">
            <h2 className="mr-auto text-sm font-medium">Кто давал скидки</h2>
            <PeriodPicker
              id="discounts-staff"
              value={view}
              today={today}
              onChange={(range) => changeView(range)}
            />
          </div>
          {byStaff.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              За этот период сотрудники скидок не давали
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {byStaff.map((s) => (
                <li key={`${s.userId}:${s.currency}`}>
                  <Link
                    href={staffHref(s.userId)}
                    className="block px-3 py-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    {staffDiscountLine(s)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <DiscountFormSheet
        workspaceId={workspaceId}
        open={panel !== null && (panel.kind === "new" || editing !== null)}
        discount={editing}
        plans={plans}
        activeFamily={activeFamily}
        onClose={() => openPanel(null)}
        onSaved={() => void load()}
        onReload={async (id) => {
          // The list refreshes too; the archive holds the discount whatever
          // the view shows.
          void load()
          const all = await listDiscounts({ workspaceId, archived: true })
          return all.data.find((d) => d.id === id) ?? null
        }}
      />
    </div>
  )
}

function DiscountRow({
  discount: d,
  today,
  onOpen,
}: {
  discount: Discount
  today: string
  onOpen: () => void
}) {
  const status = DISCOUNT_STATUS_LABEL[d.status]
  const dates = discountDatesText(d, today)
  return (
    <tr
      tabIndex={0}
      aria-label={`Скидка «${d.name}»`}
      className={cn(
        "cursor-pointer align-top transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
        status && "text-muted-foreground",
      )}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault()
          onOpen()
        }
      }}
    >
      <td className="p-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{d.name}</span>
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </div>
        <div className="text-xs text-muted-foreground">{discountHowText(d)}</div>
      </td>
      <td className="whitespace-nowrap p-3 tabular-nums">{discountSizeText(d)}</td>
      <td className="p-3">
        <div>{discountScopeText(d)}</div>
        {dates && <div className="text-xs text-muted-foreground">{dates}</div>}
      </td>
      <td className="p-3 text-muted-foreground">{discountUsageText(d)}</td>
    </tr>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  )
}
