import { cap, countForm, type ClubVocabulary } from "@clubspace/ui-kit/brand"

import type { PayrollAdjustment, PayrollLine, PayrollMonth, PayrollRate } from "../../shared/api/payroll"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"

// Pure text and month helpers of «Отчёты → Выплаты» (design
// docs/design/2026-11-26-coach-payroll.md §4). Months are club-local `YYYY-MM`.

const MONTH_NOM = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const

const MONTH_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export const isMonth = (raw: string | null | undefined): raw is string =>
  !!raw && MONTH_RE.test(raw)

const parts = (month: string): [number, number] => {
  const [y, m] = month.split("-").map(Number)
  return [y, m]
}

export const addMonths = (month: string, delta: number): string => {
  const [y, m] = parts(month)
  const index = y * 12 + (m - 1) + delta
  const year = Math.floor(index / 12)
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`
}

// «ноябрь»
export const monthName = (month: string): string => MONTH_NOM[parts(month)[1] - 1]

// «Ноябрь 2026»
export const monthTitle = (month: string): string => `${cap(monthName(month))} ${parts(month)[0]}`

// «декабря 2026» — the rate's «с …»; the year only when it is not `thisYear`.
export const monthFrom = (month: string, thisYear?: number): string => {
  const [y, m] = parts(month)
  return y === thisYear ? MONTH_GEN[m - 1] : `${MONTH_GEN[m - 1]} ${y}`
}

// `today` = the club's YYYY-MM-DD. Until the 5th the previous month is the one
// to settle; after that the current one.
export const defaultPayrollMonth = (today: string): string => {
  const month = today.slice(0, 7)
  return Number(today.slice(8, 10)) <= 5 ? addMonths(month, -1) : month
}

// `?month=`: a well-formed month up to the current one, else the default.
export const pickPayrollMonth = (raw: string | null, today: string): string =>
  isMonth(raw) && raw <= today.slice(0, 7) ? raw : defaultPayrollMonth(today)

// «+5 000 ₽» / «−2 000 ₽»
export const signedMoney = (amount: number, currency: string): string =>
  `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${formatAmount(Math.abs(amount), currency)}`

// The table's rows, by name. An open month also lists every staff member who
// has no row yet (no class, adjustment or rate in force) as a zero row
// «Ставка не задана», so a fixed-pay admin or a new coach can be given a rate.
// A closed month shows exactly its snapshot.
export const payrollRows = (
  month: Pick<PayrollMonth, "status" | "lines">,
  staff: readonly { coachId: string; name: string }[],
): PayrollLine[] => {
  const rows = [...month.lines]
  if (month.status === "open") {
    const listed = new Set(rows.map((l) => l.coachId))
    for (const s of staff) {
      if (listed.has(s.coachId)) continue
      rows.push({
        coachId: s.coachId,
        name: s.name,
        rate: null,
        classes: 0,
        classesPaid: 0,
        marks: 0,
        marksPaid: 0,
        revenueBase: 0,
        amounts: { fixed: 0, classes: 0, students: 0, revenue: 0, adjustments: 0 },
        total: 0,
        adjustments: [],
        ignoredRate: null,
      })
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

// Everything except the adjustments: what the rate gave.
export const accruedOf = (line: Pick<PayrollLine, "total" | "amounts">): number =>
  line.total - line.amounts.adjustments

// «Ольга Кузнецова» → «О. Кузнецова»; one word stays as it is.
export const shortName = (name: string): string => {
  const words = name.trim().split(/\s+/)
  return words.length < 2 ? name.trim() : `${words[0][0]}. ${words.slice(1).join(" ")}`
}

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" })

// «2 дек.»
export const shortDate = (iso: string, timeZone?: string): string =>
  (timeZone
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone })
    : dayFmt
  ).format(new Date(iso))

// «Закрыт 2 дек. · Ольга Кузнецова» / «Предварительно — пересчитывается».
export const statusText = (
  month: Pick<PayrollMonth, "status" | "closedAt" | "closedBy">,
  timeZone?: string,
): string => {
  if (month.status !== "closed" || !month.closedAt) return "Предварительно — пересчитывается"
  const who = month.closedBy ? ` · ${month.closedBy.name}` : ""
  return `Закрыт ${shortDate(month.closedAt, timeZone)}${who}`
}

// «+5 000 ₽ · Открытый урок · О. Кузнецова, 30 нояб.»; one in another currency
// than the month's is not counted and says so.
export const adjustmentText = (
  adj: Pick<PayrollAdjustment, "amount" | "currency" | "ignored" | "comment" | "createdAt" | "createdByName">,
  timeZone?: string,
): string =>
  `${signedMoney(adj.amount, adj.currency)} · ${adj.comment} · ${shortName(adj.createdByName)}, ${shortDate(adj.createdAt, timeZone)}${
    adj.ignored ? " · не учтена: другая валюта" : ""
  }`

// Why a row has no rate: none set, or one in another currency than the month's.
export const missingRateText = (line: Pick<PayrollLine, "ignoredRate">, currency: string): string =>
  line.ignoredRate
    ? `Ставка в ${line.ignoredRate.currency} не применяется — задайте ставку в ${currency}`
    : "Ставка не задана"

const percentText = (bp: number): string =>
  `${(bp / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`

// The rate's parts in force, non-zero only: «Оклад 30 000 ₽ · 1 500 ₽ за
// тренировку (от 3 учеников) · 100 ₽ за отметку · 10 % от оплат».
export const rateText = (rate: PayrollRate, v: ClubVocabulary, currency: string): string => {
  const out: string[] = []
  if (rate.fixedMonthly > 0) out.push(`Оклад ${formatAmount(rate.fixedMonthly, currency)}`)
  if (rate.perClass > 0) {
    const min = rate.perClassMinStudents
    out.push(
      `${formatAmount(rate.perClass, currency)} за ${v.session.acc}${
        min > 1 ? ` (от ${min} ${pluralRu(min, "ученика", "учеников", "учеников")})` : ""
      }`,
    )
  }
  if (rate.perStudent > 0) out.push(`${formatAmount(rate.perStudent, currency)} за отметку`)
  if (rate.revenueBp > 0) out.push(`${percentText(rate.revenueBp)} от оплат учеников`)
  return out.length > 0 ? out.join(" · ") : "Ставка нулевая"
}

// The breakdown of a line, non-zero parts only (the panel's facts).
export const lineFacts = (line: PayrollLine, v: ClubVocabulary, currency: string): string[] => {
  const rate = line.rate
  if (!rate) return []
  const out: string[] = []
  const a = line.amounts
  if (a.fixed !== 0) out.push(`Оклад ${formatAmount(a.fixed, currency)}`)
  if (rate.perClass > 0 && line.classes > 0) {
    const unpaid = line.classes - line.classesPaid
    const tail =
      unpaid > 0
        ? ` (ещё ${unpaid} не ${pluralRu(unpaid, "оплачено", "оплачены", "оплачены")}: пришло меньше ${rate.perClassMinStudents})`
        : ""
    out.push(
      `За ${v.session.nomPl}: ${line.classesPaid} × ${formatAmount(rate.perClass, currency)} = ${formatAmount(a.classes, currency)}${tail}`,
    )
  }
  if (a.students !== 0) {
    out.push(
      `За отметки: ${line.marksPaid} × ${formatAmount(rate.perStudent, currency)} = ${formatAmount(a.students, currency)}`,
    )
  }
  if (rate.revenueBp > 0 && line.revenueBase !== 0) {
    out.push(
      `Процент: ${percentText(rate.revenueBp)} от ${formatAmount(line.revenueBase, currency)} = ${formatAmount(a.revenue, currency)}`,
    )
  }
  return out
}

// «Не распределено: 3 тренировки без тренера, оплаты 4 500 ₽ — не нашлось ни
// посещений, ни группы ученика»; null when nothing is unattributed.
export const unattributedText = (
  month: Pick<PayrollMonth, "unattributed" | "currency">,
  v: ClubVocabulary,
): string | null => {
  const { classes, revenue, otherCurrency } = month.unattributed
  const parts: string[] = []
  if (classes > 0) parts.push(`${classes} ${countForm(classes, v.session, pluralRu)} без ${v.coach.gen}`)
  if (revenue !== 0) {
    parts.push(
      `оплаты ${formatAmount(revenue, month.currency)} — не нашлось ни посещений, ни группы ученика`,
    )
  }
  if (otherCurrency !== 0) {
    parts.push(
      `${otherCurrency} ${pluralRu(otherCurrency, "оплата", "оплаты", "оплат")} в другой валюте`,
    )
  }
  return parts.length > 0 ? `Не распределено: ${parts.join(", ")}` : null
}

// A closed month whose live recomputation differs from the snapshot: the total
// difference and who it concerns («Д. Решетюк +1 500 ₽, И. Шекунов −1 500 ₽»).
// Offsetting changes keep the total (drift 0) but still name the people.
export const driftText = (
  month: Pick<PayrollMonth, "drift" | "driftByCoach" | "currency">,
  v: ClubVocabulary,
): string | null => {
  const d = month.drift
  if (d === null) return null
  const who = month.driftByCoach
    .map((c) => `${c.name} ${signedMoney(c.delta, month.currency)}`)
    .join(", ")
  const n = month.driftByCoach.length
  const head =
    d === 0
      ? `итог тот же, но изменились суммы у ${n} ${pluralRu(n, v.coach.gen, v.coach.genPl, v.coach.genPl)}`
      : `сейчас вышло бы на ${formatAmount(Math.abs(d), month.currency)} ${d > 0 ? "больше" : "меньше"}`
  return `С момента закрытия данные изменились: ${head}${who ? ` (${who})` : ""}. Учтите разницу корректировкой в следующем месяце.`
}

// «Закрыть ноябрь?» with what gets fixed and who will see it.
export const closeConfirmText = (
  month: Pick<PayrollMonth, "month" | "total" | "currency" | "lines">,
  coachPayVisible: boolean,
  v: ClubVocabulary,
): { title: string; description: string } => {
  const name = monthName(month.month)
  const n = month.lines.length
  const seen = coachPayVisible ? ` ${cap(v.coach.nomPl)} увидят свои выплаты в приложении.` : ""
  return {
    title: `Закрыть ${name}?`,
    description: `Суммы зафиксируются: ${n} ${countForm(n, v.coach, pluralRu)}, итого ${formatAmount(
      month.total,
      month.currency,
    )}. Правки посещаемости и ставок после закрытия на ${name} не повлияют.${seen}`,
  }
}

// The months a rate may start from: the viewed (open) month up to two months
// ahead of the club's current one. A later closed month is refused by the
// server (409) and the form shows its message.
export const rateMonthOptions = (viewed: string, current: string): string[] => {
  const out: string[] = []
  for (let m = viewed; m <= addMonths(current, 2); m = addMonths(m, 1)) out.push(m)
  return out
}

// The rate form: amounts as typed, the percent with up to two decimals.
export type RateForm = {
  effectiveFrom: string
  fixedMonthly: string
  perClass: string
  perClassMinStudents: string
  perStudent: string
  percent: string
}

const amountField = (n: number): string => (n === 0 ? "" : String(n))

export const rateFormOf = (rate: PayrollRate | null, effectiveFrom: string): RateForm => ({
  effectiveFrom,
  fixedMonthly: amountField(rate?.fixedMonthly ?? 0),
  perClass: amountField(rate?.perClass ?? 0),
  perClassMinStudents: String(rate?.perClassMinStudents ?? 1),
  perStudent: amountField(rate?.perStudent ?? 0),
  percent:
    rate && rate.revenueBp > 0
      ? (rate.revenueBp / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/\s/g, "")
      : "",
})

// «10», «7,5», «12.25» → basis points (1 % = 100); null when not a percent
// with at most two decimals in `range` (bp).
export const parsePercentBp = (raw: string, range: { min: number; max: number }): number | null => {
  const s = raw.replace(/\s/g, "").replace(",", ".")
  if (s === "") return 0
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const bp = Math.round(Number(s) * 100)
  return bp < range.min || bp > range.max ? null : bp
}
