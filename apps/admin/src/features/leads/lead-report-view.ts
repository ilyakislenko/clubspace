// Pure wording of «Отчёты → Пробные» (docs/design/2026-11-26-leads.md §4.5).

import type { LeadConversionReport, LeadLostReason } from "../../shared/api/leads"
import { pluralRu } from "../../shared/lib/plural-ru"
import { LEAD_SOURCES, SOURCE_LABEL } from "./lead-view"

export const PERIOD_PRESETS = [30, 90, 365] as const
export type PeriodDays = (typeof PERIOD_PRESETS)[number]

type Stats = LeadConversionReport["total"]

const EMPTY_STATS: Stats = {
  received: 0,
  contacted: 0,
  trialBooked: 0,
  came: 0,
  bought: 0,
  lostByReason: [],
  medianContactHours: null,
}

const ymd = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The last `days` calendar days, today included.
export const periodRange = (days: number, now: Date): { from: string; to: string } => {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return { from: ymd(from), to: ymd(now) }
}

// One row per source in the filter's order (a source without requests reads
// zeros), then «Итого».
export const reportRows = (
  report: LeadConversionReport,
): Array<{ key: string; label: string; stats: Stats }> => [
  ...LEAD_SOURCES.map((source) => ({
    key: source,
    label: SOURCE_LABEL[source],
    stats: report.bySource.find((s) => s.source === source) ?? EMPTY_STATS,
  })),
  { key: "total", label: "Итого", stats: report.total },
]

// «из заявки в покупку»: whole percent, «—» with no requests.
export const conversionPct = (s: Pick<Stats, "received" | "bought">): string =>
  s.received > 0 ? `${Math.round((s.bought / s.received) * 100)}%` : "—"

// Reasons with at least one refusal, most frequent first.
export const sortedLostReasons = (byReason: Stats["lostByReason"]): Array<[LeadLostReason, number]> =>
  byReason
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r): [LeadLostReason, number] => [r.reason, r.count])

// «40 мин», «3 ч», «2 дня».
export const hoursLabel = (hours: number): string => {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} мин`
  if (hours < 48) return `${Math.round(hours)} ч`
  const days = Math.round(hours / 24)
  return `${days} ${pluralRu(days, "день", "дня", "дней")}`
}
