import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { PayrollLine, PayrollMonth } from "../../shared/api/payroll"
import {
  addMonths,
  adjustmentText,
  closeConfirmText,
  defaultPayrollMonth,
  driftText,
  lineFacts,
  monthFrom,
  missingRateText,
  monthTitle,
  parsePercentBp,
  payrollRows,
  pickPayrollMonth,
  rateFormOf,
  rateMonthOptions,
  rateText,
  shortName,
  statusText,
  unattributedText,
} from "./payroll-view"

const SPORT = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")
// Intl groups thousands with a no-break space.
const plain = (s: string | null) => s?.replace(/\s/g, " ") ?? null

const RATE = {
  effectiveFrom: "2026-10",
  fixedMonthly: 30000,
  perClass: 1500,
  perClassMinStudents: 3,
  perStudent: 100,
  revenueBp: 1000,
  currency: "RUB",
}

const line = (over: Partial<PayrollLine> = {}): PayrollLine => ({
  coachId: "c1",
  name: "Ольга Кузнецова",
  rate: RATE,
  classes: 16,
  classesPaid: 14,
  marks: 100,
  marksPaid: 96,
  revenueBase: 84000,
  amounts: { fixed: 30000, classes: 21000, students: 9600, revenue: 8400, adjustments: 5000 },
  total: 74000,
  adjustments: [],
  ignoredRate: null,
  ...over,
})

const month = (over: Partial<PayrollMonth> = {}): PayrollMonth => ({
  month: "2026-11",
  status: "open",
  canClose: true,
  closedAt: null,
  closedBy: null,
  currency: "RUB",
  total: 412000,
  drift: null,
  driftByCoach: [],
  unattributed: { classes: 0, revenue: 0, otherCurrency: 0 },
  lines: Array.from({ length: 8 }, (_, i) => line({ coachId: `c${i}` })),
  ...over,
})

describe("months", () => {
  it("steps across years", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01")
    expect(addMonths("2026-01", -1)).toBe("2025-12")
    expect(addMonths("2026-11", -13)).toBe("2025-10")
  })

  it("titles and «с …»", () => {
    expect(monthTitle("2026-11")).toBe("Ноябрь 2026")
    expect(monthFrom("2026-12", 2026)).toBe("декабря")
    expect(monthFrom("2027-01", 2026)).toBe("января 2027")
  })

  it("defaults to the previous month until the 5th, then the current one", () => {
    expect(defaultPayrollMonth("2026-12-01")).toBe("2026-11")
    expect(defaultPayrollMonth("2026-12-05")).toBe("2026-11")
    expect(defaultPayrollMonth("2026-12-06")).toBe("2026-12")
    expect(defaultPayrollMonth("2027-01-03")).toBe("2026-12")
  })

  it("takes ?month= only when well-formed and not in the future", () => {
    expect(pickPayrollMonth("2026-09", "2026-11-20")).toBe("2026-09")
    expect(pickPayrollMonth("2026-12", "2026-11-20")).toBe("2026-11")
    expect(pickPayrollMonth("2026-13", "2026-11-20")).toBe("2026-11")
    expect(pickPayrollMonth(null, "2026-11-02")).toBe("2026-10")
  })

  it("offers rate months from the viewed one to two months ahead", () => {
    expect(rateMonthOptions("2026-10", "2026-11")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"])
  })
})

describe("breakdown", () => {
  it("lists the non-zero parts with the unpaid classes and why", () => {
    expect(lineFacts(line(), SPORT, "RUB").map(plain)).toEqual([
      "Оклад 30 000 ₽",
      "За тренировки: 14 × 1 500 ₽ = 21 000 ₽ (ещё 2 не оплачены: пришло меньше 3)",
      "За отметки: 96 × 100 ₽ = 9 600 ₽",
      "Процент: 10 % от 84 000 ₽ = 8 400 ₽",
    ])
  })

  it("speaks the club's words and skips zero parts", () => {
    const l = line({
      rate: { ...RATE, fixedMonthly: 0, perStudent: 0, revenueBp: 0, perClass: 2000 },
      classes: 3,
      classesPaid: 3,
      amounts: { fixed: 0, classes: 6000, students: 0, revenue: 0, adjustments: 0 },
    })
    expect(lineFacts(l, DANCE, "RUB").map(plain)).toEqual(["За занятия: 3 × 2 000 ₽ = 6 000 ₽"])
  })

  it("has no facts without a rate", () => {
    expect(lineFacts(line({ rate: null }), SPORT, "RUB")).toEqual([])
  })

  it("says the rate in one line", () => {
    expect(plain(rateText(RATE, SPORT, "RUB"))).toBe(
      "Оклад 30 000 ₽ · 1 500 ₽ за тренировку (от 3 учеников) · 100 ₽ за отметку · 10 % от оплат учеников",
    )
    expect(
      plain(rateText({ ...RATE, fixedMonthly: 0, perClassMinStudents: 1, perStudent: 0, revenueBp: 1050 }, DANCE, "RUB")),
    ).toBe(
      "1 500 ₽ за занятие · 10,5 % от оплат учеников",
    )
  })

  it("writes an adjustment with its author and day, and marks one in another currency", () => {
    const adj = {
      amount: -2000,
      currency: "RUB",
      ignored: false,
      comment: "Опоздания",
      createdAt: "2026-11-30T09:00:00.000Z",
      createdByName: "Ольга Кузнецова",
    }
    expect(plain(adjustmentText(adj, "Europe/Moscow"))).toBe("−2 000 ₽ · Опоздания · О. Кузнецова, 30 нояб.")
    expect(plain(adjustmentText({ ...adj, currency: "KZT", ignored: true }, "Europe/Moscow"))).toBe(
      "−2 000 KZT · Опоздания · О. Кузнецова, 30 нояб. · не учтена: другая валюта",
    )
    expect(shortName("Ольга")).toBe("Ольга")
  })

  it("says why a row has no rate", () => {
    expect(missingRateText(line({ rate: null }), "RUB")).toBe("Ставка не задана")
    expect(missingRateText(line({ rate: null, ignoredRate: { ...RATE, currency: "KZT" } }), "RUB")).toBe(
      "Ставка в KZT не применяется — задайте ставку в RUB",
    )
  })
})

describe("month lines", () => {
  it("names who closed and when", () => {
    expect(statusText(month())).toBe("Предварительно — пересчитывается")
    expect(
      statusText(
        month({
          status: "closed",
          closedAt: "2026-12-02T10:00:00.000Z",
          closedBy: { id: "u1", name: "Ольга Кузнецова" },
        }),
        "Europe/Moscow",
      ),
    ).toBe("Закрыт 2 дек. · Ольга Кузнецова")
  })

  it("shows unattributed parts only when non-zero", () => {
    expect(unattributedText(month(), SPORT)).toBeNull()
    expect(plain(unattributedText(month({ unattributed: { classes: 3, revenue: 4500, otherCurrency: 0 } }), SPORT))).toBe(
      "Не распределено: 3 тренировки без тренера, оплаты 4 500 ₽ — не нашлось ни посещений, ни группы ученика",
    )
  })

  it("shows the drift of a closed month in either direction, naming who it concerns", () => {
    expect(driftText(month(), SPORT)).toBeNull()
    expect(
      plain(driftText(month({ drift: 1200, driftByCoach: [{ coachId: "c1", name: "Д. Решетюк", delta: 1200 }] }), SPORT)),
    ).toBe(
      "С момента закрытия данные изменились: сейчас вышло бы на 1 200 ₽ больше (Д. Решетюк +1 200 ₽). Учтите разницу корректировкой в следующем месяце.",
    )
    expect(plain(driftText(month({ drift: -300 }), SPORT))).toContain("на 300 ₽ меньше")
  })

  it("names offsetting changes that keep the total", () => {
    const swapped = month({
      drift: 0,
      driftByCoach: [
        { coachId: "c1", name: "Д. Решетюк", delta: 1500 },
        { coachId: "c2", name: "И. Шекунов", delta: -1500 },
      ],
    })
    expect(plain(driftText(swapped, SPORT))).toBe(
      "С момента закрытия данные изменились: итог тот же, но изменились суммы у 2 тренеров (Д. Решетюк +1 500 ₽, И. Шекунов −1 500 ₽). Учтите разницу корректировкой в следующем месяце.",
    )
  })

  it("lists staff without a row as zero rows in an open month only, by name", () => {
    const staff = [
      { coachId: "c0", name: "Ольга Кузнецова" },
      { coachId: "new", name: "Борис Новиков" },
    ]
    const open = month({ lines: [line({ coachId: "c0", name: "Ольга Кузнецова" })] })
    const rows = payrollRows(open, staff)
    expect(rows.map((r) => r.name)).toEqual(["Борис Новиков", "Ольга Кузнецова"])
    expect(rows[0]).toMatchObject({ coachId: "new", rate: null, classes: 0, total: 0, adjustments: [] })
    expect(payrollRows({ ...open, status: "closed" }, staff).map((r) => r.coachId)).toEqual(["c0"])
  })

  it("confirms a close with the total, and says coaches will see it only when the club shows it", () => {
    const close = closeConfirmText(month(), false, SPORT)
    expect(close.title).toBe("Закрыть ноябрь?")
    expect(plain(close.description)).toBe(
      "Суммы зафиксируются: 8 тренеров, итого 412 000 ₽. Правки посещаемости и ставок после закрытия на ноябрь не повлияют.",
    )
    expect(plain(closeConfirmText(month(), true, DANCE).description)).toBe(
      "Суммы зафиксируются: 8 педагогов, итого 412 000 ₽. Правки посещаемости и ставок после закрытия на ноябрь не повлияют. Педагоги увидят свои выплаты в приложении.",
    )
  })
})

describe("rate form", () => {
  it("prefills from the rate in force, empty for zero parts", () => {
    expect(rateFormOf({ ...RATE, perStudent: 0, revenueBp: 1050 }, "2026-11")).toEqual({
      effectiveFrom: "2026-11",
      fixedMonthly: "30000",
      perClass: "1500",
      perClassMinStudents: "3",
      perStudent: "",
      percent: "10,5",
    })
    expect(rateFormOf(null, "2026-11").perClassMinStudents).toBe("1")
  })

  it("parses a percent with up to two decimals into basis points", () => {
    const range = { min: 0, max: 10000 }
    expect(parsePercentBp("10", range)).toBe(1000)
    expect(parsePercentBp("7,5", range)).toBe(750)
    expect(parsePercentBp("12.25", range)).toBe(1225)
    expect(parsePercentBp("", range)).toBe(0)
    expect(parsePercentBp("1.234", range)).toBeNull()
    expect(parsePercentBp("101", range)).toBeNull()
    expect(parsePercentBp("-1", range)).toBeNull()
  })
})
