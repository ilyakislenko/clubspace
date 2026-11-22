"use client"

import { useState } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"

import { downloadExport, type ExportKind } from "../../shared/api/exports"
import { errorMessage } from "../../shared/lib/error-message"
import { customRangeError } from "../payments/journal-view"

const EXPORTS: { kind: ExportKind; label: string }[] = [
  { kind: "members", label: "Участники (CSV)" },
  { kind: "renewals", label: "На продление (CSV)" },
  { kind: "attendance", label: "Посещаемость (CSV)" },
  { kind: "payments", label: "Платежи и возвраты (CSV)" },
]

// «Отчёты → Выгрузка»: CSV files for Excel / Google Таблицы. The period
// filters attendance, renewals and payments; members is always the full list.
export function DataExportCard({ workspaceId }: { workspaceId: string }) {
  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  // payments.csv takes both dates or neither, ≤ 366 days (the journal's rule);
  // attendance and renewals also take an open-ended period.
  const paymentsRangeError = from || to ? customRangeError(from, to) : null

  const handleExport = async (kind: ExportKind) => {
    setExporting(kind)
    setError(null)
    try {
      await downloadExport({
        workspaceId,
        kind,
        ...(kind === "members"
          ? {}
          : { query: { from: from || undefined, to: to || undefined } }),
      })
    } catch (err) {
      setError(errorMessage(err, "Не удалось выгрузить данные"))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">
        Выгрузка в CSV — открывается в Excel / Google Таблицах. Участники —
        контакты, роль, доступ и абонемент; Платежи и возвраты — оплаты
        абонементов и событий и возвраты по ним (со знаком минус) для
        бухгалтерии, как в «Абонементы → Платежи». Период фильтрует
        посещаемость и платежи (без периода платежи — за последние 30 дней;
        участники — всегда полный список).
      </p>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="export-from" className="text-xs text-muted-foreground">
            С
          </Label>
          <Input
            id="export-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="export-to" className="text-xs text-muted-foreground">
            По
          </Label>
          <Input
            id="export-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 w-[160px]"
          />
        </div>
        {(from || to) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9"
            onClick={() => {
              setFrom("")
              setTo("")
            }}
          >
            Сбросить период
          </Button>
        )}
      </div>
      {paymentsRangeError && (
        <p className="mt-2 text-sm text-destructive">Для платежей: {paymentsRangeError}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {EXPORTS.map(({ kind, label }) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="secondary"
            disabled={exporting !== null || (kind === "payments" && paymentsRangeError !== null)}
            onClick={() => void handleExport(kind)}
          >
            {exporting === kind ? "Готовим…" : label}
          </Button>
        ))}
      </div>
    </div>
  )
}
