import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { MyPayrollMonth } from "../../shared/api/payroll"
import { countsText, currentText, monthFacts, monthLabel, rateText, signedMoney } from "./my-pay"

const SPORT = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")
// formatMoney groups thousands with a narrow no-break space.
const plain = (s: string) => s.replace(/\s/g, " ")

const RATE = {
  effectiveFrom: "2026-10",
  fixedMonthly: 30000,
  perClass: 1500,
  perClassMinStudents: 3,
  perStudent: 100,
  revenueBp: 1050,
  currency: "RUB",
}

const month = (over: Partial<MyPayrollMonth> = {}): MyPayrollMonth => ({
  month: "2026-11",
  closedAt: "2026-12-02T10:00:00.000Z",
  currency: "RUB",
  rate: RATE,
  classes: 16,
  classesPaid: 14,
  marks: 100,
  marksPaid: 96,
  revenueBase: 84000,
  amounts: { fixed: 30000, classes: 21000, students: 9600, revenue: 8820, adjustments: 5000 },
  total: 74420,
  adjustments: [{ id: "a1", amount: 5000, comment: "Открытый урок", createdAt: "2026-11-30T10:00:00.000Z" }],
  ...over,
})

describe("my pay", () => {
  it("names the month, with the year only for another year", () => {
    expect(monthLabel("2026-11", "2026-12")).toBe("Ноябрь")
    expect(monthLabel("2025-12", "2026-01")).toBe("Декабрь 2025")
  })

  it("says this month's counts without money", () => {
    expect(currentText({ month: "2026-12", classes: 12, marks: 87 }, SPORT)).toBe(
      "В этом месяце: 12 тренировок · 87 отметок",
    )
    expect(currentText({ month: "2026-12", classes: 1, marks: 2 }, DANCE)).toBe(
      "В этом месяце: 1 занятие · 2 отметки",
    )
  })

  it("breaks a closed month into its non-zero parts", () => {
    expect(monthFacts(month(), SPORT).map(plain)).toEqual([
      "Оклад 30 000 ₽",
      "За тренировки: 14 × 1 500 ₽ = 21 000 ₽ (ещё 2 не оплачены: пришло меньше 3)",
      "За отметки: 96 × 100 ₽ = 9 600 ₽",
      "Процент: 10,5 % от 84 000 ₽ = 8 820 ₽",
    ])
    expect(monthFacts(month({ rate: null }), SPORT)).toEqual([])
  })

  it("writes adjustments, counts and the rate", () => {
    expect(plain(signedMoney(5000, "RUB"))).toBe("+5 000 ₽")
    expect(plain(signedMoney(-200, "RUB"))).toBe("−200 ₽")
    expect(countsText(month(), DANCE)).toBe("16 занятий · 100 отметок")
    expect(plain(rateText(RATE, SPORT))).toBe(
      "Ставка: оклад 30 000 ₽ · 1 500 ₽ за тренировку от 3 учеников · 100 ₽ за отметку · 10,5 % от оплат учеников",
    )
    expect(rateText({ ...RATE, fixedMonthly: 0, perClass: 0, perStudent: 0, revenueBp: 0 }, SPORT)).toBe(
      "Ставка нулевая",
    )
  })
})
