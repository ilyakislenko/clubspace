"use client"

import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { downloadExport } from "../../shared/api/exports"
import { getWorkspaceSettings } from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { clubToday } from "../payments/journal-view"
import { addMonths, defaultPayrollMonth, monthTitle } from "./payroll-view"

// How many past months the select offers (the page itself goes further back).
const MONTHS_BACK = 12

// «Отчёты → Выгрузка»: «Выплаты за месяц» — the month's payroll CSV for the
// accountant (the closed snapshot, or the preliminary numbers of an open month).
export function PayrollExportCard({ workspaceId }: { workspaceId: string }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [month, setMonth] = useState("")
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getWorkspaceSettings({ workspaceId })
      .then((s) => s.timezone)
      .catch(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
      .then((tz) => {
        const today = clubToday(tz)
        setCurrent(today.slice(0, 7))
        setMonth(defaultPayrollMonth(today))
      })
  }, [workspaceId])

  if (!current) return null

  const options = Array.from({ length: MONTHS_BACK + 1 }, (_, i) => addMonths(current, -i))

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    try {
      await downloadExport({ workspaceId, kind: "payroll", query: { month } })
    } catch (err) {
      setError(errorMessage(err, "Не удалось выгрузить выплаты"))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-medium">Выплаты за месяц</div>
      <p className="mt-1 text-sm text-muted-foreground">
        Начисления каждому по ставке и корректировки, до налогов. Закрытый месяц — зафиксированные
        суммы, открытый — предварительные.
      </p>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={inputCls}
          aria-label="Месяц"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {monthTitle(m)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={exporting}
          onClick={() => void handleExport()}
        >
          {exporting ? "Готовим…" : "Выплаты (CSV)"}
        </Button>
      </div>
    </div>
  )
}
