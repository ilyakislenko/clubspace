"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { cap } from "@clubspace/ui-kit/brand"
import { Button } from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

import { downloadExport } from "../../shared/api/exports"
import {
  closePayrollMonth,
  getPayrollMonth,
  listCoachRates,
  type PayrollLine,
  type PayrollMonth,
} from "../../shared/api/payroll"
import { getWorkspaceSettings } from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { useThrottledCallback } from "../../shared/lib/throttle"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { clubToday } from "../payments/journal-view"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  accruedOf,
  addMonths,
  closeConfirmText,
  driftText,
  missingRateText,
  monthTitle,
  payrollRows,
  pickPayrollMonth,
  signedMoney,
  statusText,
  unattributedText,
} from "./payroll-view"
import { PayrollCoachSheet } from "./PayrollCoachSheet"
import { PayrollReopenSheet } from "./PayrollReopenSheet"

// Attendance and payroll writes arrive live; the month re-reads at most this often.
const REFRESH_MS = 5_000
// Payroll writes (realtime `payroll`) and attendance marks (`attendance`).
const REALTIME = ["payroll", "attendance"]

type Club = { timezone: string; coachPayVisible: boolean }
type View = { month: string; coachId: string | null }

const readUrl = (today: string): View => {
  const p = new URLSearchParams(window.location.search)
  return { month: pickPayrollMonth(p.get("month"), today), coachId: p.get("coach") }
}

const writeUrl = (view: View) => {
  const p = new URLSearchParams()
  p.set("month", view.month)
  if (view.coachId) p.set("coach", view.coachId)
  const url = new URL(window.location.href)
  url.search = p.toString()
  window.history.replaceState(window.history.state, "", url)
}

/**
 * «Отчёты → Выплаты» (club admins): what each coach earned in a club-local
 * month, before taxes. A row opens the coach's breakdown, rate and adjustments
 * in a side panel (`?coach=`); «Закрыть месяц» freezes the sums. The URL holds
 * the month.
 */
export function PayrollMonthView({ workspaceId }: { workspaceId: string }) {
  const vocabulary = useVocabulary()
  const [club, setClub] = useState<Club | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [data, setData] = useState<PayrollMonth | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The server's answer to a refused close (sums changed, already closed).
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reopening, setReopening] = useState(false)
  // Staff who may hold a rate (listCoachRates): an open month lists the ones
  // without a row too, so they can be given a rate.
  const [staff, setStaff] = useState<{ coachId: string; name: string }[]>([])

  useEffect(() => {
    void getWorkspaceSettings({ workspaceId })
      .then((s) => setClub({ timezone: s.timezone, coachPayVisible: s.coachPayVisible }))
      .catch(() =>
        setClub({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, coachPayVisible: false }),
      )
  }, [workspaceId])

  useEffect(() => {
    if (club) setView(readUrl(clubToday(club.timezone)))
  }, [club])

  const month = view?.month ?? null
  const load = useCallback(async () => {
    if (!month) return
    try {
      const [next, rates] = await Promise.all([
        getPayrollMonth({ workspaceId, month }),
        // Best effort: without it the table still shows the month's rows.
        listCoachRates({ workspaceId }).catch(() => null),
      ])
      setData(next)
      if (rates) setStaff(rates.coaches)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить выплаты"))
    }
  }, [workspaceId, month])

  useEffect(() => {
    setData(null)
    setNotice(null)
    void load()
  }, [load])

  const refresh = useThrottledCallback(() => void load(), REFRESH_MS)
  useWorkspaceRealtime(workspaceId, REALTIME, refresh)

  const changeView = (patch: Partial<View>) => {
    if (!view) return
    const next = { ...view, ...patch }
    setView(next)
    writeUrl(next)
  }

  if (!club || !view) return <Skeleton />

  const current = clubToday(club.timezone).slice(0, 7)
  const shown = data?.month === view.month ? data : null
  const closed = shown?.status === "closed"
  const lines = shown ? payrollRows(shown, staff) : []
  const selected = view.coachId ? (lines.find((l) => l.coachId === view.coachId) ?? null) : null
  const currency = shown?.currency ?? "RUB"
  const unattributed = shown ? unattributedText(shown, vocabulary) : null
  const drift = shown && closed ? driftText(shown, vocabulary) : null

  const close = async () => {
    if (!shown) return
    const text = closeConfirmText(shown, club.coachPayVisible, vocabulary)
    if (!(await confirmDialog({ ...text, confirmLabel: "Закрыть месяц" }))) return
    setBusy(true)
    setNotice(null)
    try {
      setData(
        await closePayrollMonth({
          workspaceId,
          month: shown.month,
          expectedTotal: shown.total,
          // The per-coach sums on screen: offsetting changes are refused too.
          expectedLines: shown.lines.map((l) => ({ coachId: l.coachId, total: l.total })),
        }),
      )
    } catch (e) {
      setNotice(errorMessage(e, "Не удалось закрыть месяц"))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const csv = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await downloadExport({ workspaceId, kind: "payroll", query: { month: view.month } })
    } catch (e) {
      setNotice(errorMessage(e, "Не удалось выгрузить CSV"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Предыдущий месяц"
            onClick={() => changeView({ month: addMonths(view.month, -1), coachId: null })}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-36 text-center text-base font-medium">{monthTitle(view.month)}</h2>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Следующий месяц"
            disabled={view.month >= current}
            onClick={() => changeView({ month: addMonths(view.month, 1), coachId: null })}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {shown && (
          <span className="text-sm text-muted-foreground">{statusText(shown, club.timezone)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {shown && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void csv()}>
              Скачать CSV
            </Button>
          )}
          {closed && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setReopening(true)}>
              Открыть заново
            </Button>
          )}
          {shown?.canClose && (
            <Button type="button" disabled={busy} onClick={() => void close()}>
              Закрыть месяц
            </Button>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Расчёт до налогов. Выплату и налоги клуб оформляет сам.
      </p>

      {notice && <Alert>{notice}</Alert>}
      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
            Повторить
          </Button>
        </div>
      )}

      {!shown ? (
        error ? null : <Skeleton />
      ) : lines.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          В этом месяце {vocabulary.session.genPl} не было и ставки не заданы
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-normal">{cap(vocabulary.coach.nom)}</th>
                <th className="p-3 text-right font-normal">{cap(vocabulary.session.genPl)}</th>
                <th className="p-3 text-right font-normal">Отметок</th>
                <th className="p-3 text-right font-normal">Начислено</th>
                <th className="p-3 text-right font-normal">Корректировки</th>
                <th className="p-3 text-right font-normal">Итого</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line) => (
                <PayrollRow
                  key={line.coachId}
                  line={line}
                  currency={currency}
                  onOpen={() => changeView({ coachId: line.coachId })}
                />
              ))}
            </tbody>
            <tfoot className="border-t border-border font-medium">
              <tr>
                <td className="p-3" colSpan={5}>
                  Итого
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">
                  {formatAmount(shown.total, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {unattributed && <p className="text-sm text-muted-foreground">{unattributed}</p>}
      {drift && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          {drift}
        </p>
      )}

      {shown && (
        <PayrollCoachSheet
          workspaceId={workspaceId}
          month={shown}
          line={selected}
          currentMonth={current}
          timezone={club.timezone}
          coachPayVisible={club.coachPayVisible}
          startWithRate={selected !== null && !shown.lines.some((l) => l.coachId === selected.coachId)}
          onClose={() => changeView({ coachId: null })}
          onChanged={() => void load()}
        />
      )}
      {shown && closed && (
        <PayrollReopenSheet
          workspaceId={workspaceId}
          month={shown.month}
          open={reopening}
          onClose={() => setReopening(false)}
          onReopened={(next) => {
            setData(next)
            setReopening(false)
          }}
        />
      )}
    </div>
  )
}

function PayrollRow({
  line,
  currency,
  onOpen,
}: {
  line: PayrollLine
  currency: string
  onOpen: () => void
}) {
  const adjustments = line.amounts.adjustments
  return (
    <tr
      tabIndex={0}
      aria-label={line.name}
      className="cursor-pointer align-top transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault()
          onOpen()
        }
      }}
    >
      <td className="p-3">
        <div className="font-medium">{line.name}</div>
        {!line.rate && <div className="text-xs text-muted-foreground">{missingRateText(line, currency)}</div>}
      </td>
      <td className="whitespace-nowrap p-3 text-right tabular-nums">
        {line.classesPaid === line.classes ? line.classes : `${line.classesPaid} / ${line.classes}`}
      </td>
      <td className="whitespace-nowrap p-3 text-right tabular-nums">{line.marks}</td>
      <td className="whitespace-nowrap p-3 text-right tabular-nums">
        {formatAmount(accruedOf(line), currency)}
      </td>
      <td
        className={cn(
          "whitespace-nowrap p-3 text-right tabular-nums",
          adjustments === 0 && "text-muted-foreground",
        )}
      >
        {adjustments === 0 ? "—" : signedMoney(adjustments, currency)}
      </td>
      <td className="whitespace-nowrap p-3 text-right font-medium tabular-nums">
        {formatAmount(line.total, currency)}
      </td>
    </tr>
  )
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  )
}
