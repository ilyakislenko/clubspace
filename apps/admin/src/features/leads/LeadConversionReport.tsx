"use client"

import { useCallback, useEffect, useState } from "react"

import { getLeadConversionReport, type LeadConversionReport as Report } from "../../shared/api/leads"
import { errorMessage } from "../../shared/lib/error-message"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import {
  conversionPct,
  hoursLabel,
  PERIOD_PRESETS,
  periodRange,
  reportRows,
  sortedLostReasons,
  type PeriodDays,
} from "./lead-report-view"
import { LOST_REASON_LABEL } from "./lead-view"

/**
 * «Отчёты → Пробные»: of the requests that came in during the period, how many
 * the club reached, booked, saw and sold to — by source — why the rest said
 * no, and how fast the club calls back. Spam is not counted.
 */
export function LeadConversionReport({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState<PeriodDays>(90)
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await getLeadConversionReport({ workspaceId, ...periodRange(days, new Date()) }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить отчёт"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, days])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useWorkspaceRealtime(workspaceId, ["leads"], () => void load())

  const rows = data ? reportRows(data) : []
  const reasons = data ? sortedLostReasons(data.total.lostByReason) : []
  const median = data?.total.medianContactHours ?? null

  return (
    <div className="max-w-4xl space-y-6">
      <div role="group" aria-label="Период" className="inline-flex rounded-md border border-border p-0.5">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={days === p}
            onClick={() => setDays(p)}
            className={`rounded px-3 py-1.5 text-sm ${
              days === p ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {p} дней
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted" />
      ) : !data ? null : data.total.received === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          За этот период заявок на пробное не было.
        </p>
      ) : (
        <>
          {median !== null && (
            <p className="text-sm">
              Перезваниваем обычно через <span className="font-semibold">{hoursLabel(median)}</span>
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="p-3">Источник</th>
                  <th className="p-3 text-right">Заявок</th>
                  <th className="p-3 text-right">Связались</th>
                  <th className="p-3 text-right">Записаны</th>
                  <th className="p-3 text-right">Пришли</th>
                  <th className="p-3 text-right">Купили</th>
                  <th className="p-3 text-right">Из заявки в покупку</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.key} className={row.key === "total" ? "bg-muted/50 font-medium" : ""}>
                    <td className="p-3">{row.label}</td>
                    <td className="p-3 text-right tabular-nums">{row.stats.received}</td>
                    <td className="p-3 text-right tabular-nums">{row.stats.contacted}</td>
                    <td className="p-3 text-right tabular-nums">{row.stats.trialBooked}</td>
                    <td className="p-3 text-right tabular-nums">{row.stats.came}</td>
                    <td className="p-3 text-right tabular-nums">{row.stats.bought}</td>
                    <td className="p-3 text-right tabular-nums">{conversionPct(row.stats)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {reasons.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">Причины отказа</h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
                {reasons.map(([reason, count]) => (
                  <li key={reason} className="flex justify-between px-3 py-2">
                    <span>{LOST_REASON_LABEL[reason]}</span>
                    <span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            Считаются заявки, пришедшие за период, кроме спама. «Купили» — ученик, с которым связана
            заявка, оплатил абонемент клуба (бесплатный пробный не считается).
          </p>
        </>
      )}
    </div>
  )
}
