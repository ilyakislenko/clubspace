import { cap, countForm, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import type { MyPayroll, MyPayrollMonth } from "../../shared/api/payroll"
import { formatMoney, MONTHS_RU, pluralRu } from "../../shared/format-ru"

// Text of «Мои выплаты» (docs/design/2026-11-26-coach-payroll.md §5). Months
// are club-local "YYYY-MM".

const ym = (month: string): [number, number] => {
  const [y, m] = month.split("-").map(Number)
  return [y, m]
}

// «Ноябрь», with the year when it is not the current month's year: «Декабрь 2025».
export const monthLabel = (month: string, currentMonth: string): string => {
  const [y, m] = ym(month)
  const name = cap(MONTHS_RU[m - 1])
  return y === ym(currentMonth)[0] ? name : `${name} ${y}`
}

// «В этом месяце: 12 тренировок · 87 отметок» — counts only, no money.
export const currentText = (current: MyPayroll["current"], v: ClubVocabulary): string =>
  `В этом месяце: ${current.classes} ${countForm(current.classes, v.session, pluralRu)} · ${
    current.marks
  } ${pluralRu(current.marks, "отметка", "отметки", "отметок")}`

// «+5 000 ₽» / «−2 000 ₽»
export const signedMoney = (amount: number, currency: string): string =>
  `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${formatMoney(Math.abs(amount), currency)}`

const percent = (bp: number): string => `${String(bp / 100).replace(".", ",")} %`

// What the rate gave, non-zero parts only: «Оклад 30 000 ₽», «За тренировки:
// 14 × 1 500 ₽ = 21 000 ₽ (ещё 2 не оплачены: пришло меньше 3)», «За отметки:
// 96 × 100 ₽ = 9 600 ₽», «Процент: 10 % от 84 000 ₽ = 8 400 ₽».
export const monthFacts = (m: MyPayrollMonth, v: ClubVocabulary): string[] => {
  const rate = m.rate
  if (!rate) return []
  const money = (n: number) => formatMoney(n, m.currency)
  const a = m.amounts
  const out: string[] = []
  if (a.fixed !== 0) out.push(`Оклад ${money(a.fixed)}`)
  if (rate.perClass > 0 && m.classes > 0) {
    const unpaid = m.classes - m.classesPaid
    const tail =
      unpaid > 0
        ? ` (ещё ${unpaid} не ${pluralRu(unpaid, "оплачено", "оплачены", "оплачены")}: пришло меньше ${rate.perClassMinStudents})`
        : ""
    out.push(`За ${v.session.nomPl}: ${m.classesPaid} × ${money(rate.perClass)} = ${money(a.classes)}${tail}`)
  }
  if (a.students !== 0) {
    out.push(`За отметки: ${m.marksPaid} × ${money(rate.perStudent)} = ${money(a.students)}`)
  }
  if (rate.revenueBp > 0 && m.revenueBase !== 0) {
    out.push(`Процент: ${percent(rate.revenueBp)} от ${money(m.revenueBase)} = ${money(a.revenue)}`)
  }
  return out
}

// «12 тренировок · 87 отметок» of a closed month (shown with no rate too).
export const countsText = (m: MyPayrollMonth, v: ClubVocabulary): string =>
  `${m.classes} ${countForm(m.classes, v.session, pluralRu)} · ${m.marks} ${pluralRu(
    m.marks,
    "отметка",
    "отметки",
    "отметок",
  )}`

// The rate in one line: «1 500 ₽ за тренировку от 3 учеников · 100 ₽ за отметку».
export const rateText = (rate: NonNullable<MyPayrollMonth["rate"]>, v: ClubVocabulary): string => {
  const money = (n: number) => formatMoney(n, rate.currency)
  const out: string[] = []
  if (rate.fixedMonthly > 0) out.push(`оклад ${money(rate.fixedMonthly)}`)
  if (rate.perClass > 0) {
    const min = rate.perClassMinStudents
    out.push(
      `${money(rate.perClass)} за ${v.session.acc}${
        min > 1 ? ` от ${min} ${pluralRu(min, "ученика", "учеников", "учеников")}` : ""
      }`,
    )
  }
  if (rate.perStudent > 0) out.push(`${money(rate.perStudent)} за отметку`)
  if (rate.revenueBp > 0) out.push(`${percent(rate.revenueBp)} от оплат учеников`)
  return out.length > 0 ? `Ставка: ${out.join(" · ")}` : "Ставка нулевая"
}
