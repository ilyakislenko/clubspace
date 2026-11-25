import type { LeadConversionReport } from "../../shared/api/leads"
import { conversionPct, hoursLabel, periodRange, reportRows, sortedLostReasons } from "./lead-report-view"

const stats = (received: number, bought: number) => ({
  received,
  contacted: received,
  trialBooked: received,
  came: bought,
  bought,
  lostByReason: [],
  medianContactHours: null,
})

describe("«Отчёты → Пробные»", () => {
  it("has a row per source (zeros for a source without requests), then the total", () => {
    const report: LeadConversionReport = {
      from: "2026-10-28",
      to: "2026-11-26",
      total: stats(5, 2),
      bySource: [{ ...stats(5, 2), source: "QR" }],
    }
    expect(reportRows(report).map((r) => [r.label, r.stats.received])).toEqual([
      ["Страница клуба", 0],
      ["QR-плакат", 5],
      ["Вручную", 0],
      ["Итого", 5],
    ])
  })

  it("reads conversion, reasons, callback time and the period", () => {
    expect(conversionPct({ received: 3, bought: 1 })).toBe("33%")
    expect(conversionPct({ received: 0, bought: 0 })).toBe("—")
    expect(
      sortedLostReasons([
        { reason: "PRICE", count: 1 },
        { reason: "SCHEDULE", count: 3 },
        { reason: "OTHER", count: 0 },
      ]),
    ).toEqual([
      ["SCHEDULE", 3],
      ["PRICE", 1],
    ])
    expect(hoursLabel(0.5)).toBe("30 мин")
    expect(hoursLabel(3.2)).toBe("3 ч")
    expect(hoursLabel(72)).toBe("3 дня")
    expect(periodRange(30, new Date(2026, 10, 26))).toEqual({ from: "2026-10-28", to: "2026-11-26" })
  })
})
