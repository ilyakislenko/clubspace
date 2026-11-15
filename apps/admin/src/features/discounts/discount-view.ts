import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"

// Pure texts of «Абонементы → Скидки»: a discount's size, how it applies, its
// scope, dates, usage and status, the «Кто давал скидки» lines, and the
// «Скидка» choices of the sale and mark-paid forms. The server prices every
// option (`listSaleDiscounts`); nothing here computes a discounted amount.

type Size = { kind: "PERCENT" | "FIXED"; value: number; currency: string | null }

// «−10%» / «−500 ₽».
export const discountSizeText = (d: Size): string =>
  d.kind === "PERCENT"
    ? `−${d.value}%`
    : `−${formatAmount(d.value, d.currency ?? "RUB")}`

// «Промокод ВЕСНА» / «Семейная — сама» / «Выбирает сотрудник».
export const discountHowText = (d: { code: string | null; isFamily: boolean }): string =>
  d.isFamily ? "Семейная — сама" : d.code ? `Промокод ${d.code}` : "Выбирает сотрудник"

// The server's `normalizePromoCode` (domains/discounts/discount-rules.ts), a
// rule the contract can't carry: trimmed, upper-case, Ё → Е, 3–32 letters,
// digits or «-»; null when it doesn't fit.
export const normalizePromoCode = (raw: string): string | null => {
  const code = raw.trim().toUpperCase().replace(/Ё/g, "Е")
  return /^[A-ZА-Я0-9-]{3,32}$/.test(code) ? code : null
}

// «Все тарифы» / «3 тарифа» (+ « · события»); «Платные события» alone.
export const discountScopeText = (d: {
  allPlans: boolean
  plans: readonly unknown[]
  events: boolean
}): string => {
  const plans = d.allPlans
    ? "Все тарифы"
    : d.plans.length > 0
      ? `${d.plans.length} ${pluralRu(d.plans.length, "тариф", "тарифа", "тарифов")}`
      : null
  if (!plans) return d.events ? "Платные события" : "—"
  return d.events ? `${plans} · события` : plans
}

// «31 марта»; another year than today's adds it: «31 марта 2027».
const dayText = (ymd: string, today: string): string => {
  const [y, m, day] = ymd.split("-").map(Number)
  const text = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  })
  return ymd.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${y}`
}

// «до 31 марта» / «с 1 марта» / «с 1 по 31 марта»-style pair; null when open.
export const discountDatesText = (
  d: { startsOn: string | null; endsOn: string | null },
  today: string,
): string | null => {
  const from = d.startsOn ? `с ${dayText(d.startsOn, today)}` : null
  const to = d.endsOn ? `до ${dayText(d.endsOn, today)}` : null
  return from && to ? `${from} ${to}` : (from ?? to)
}

// «использована 14 раз из 50 · скидок на 8 400 ₽»; «ещё не использовали».
export const discountUsageText = (d: {
  uses: number
  maxUses: number | null
  given: readonly { currency: string; amount: number }[]
}): string => {
  const times = `${d.uses} ${pluralRu(d.uses, "раз", "раза", "раз")}`
  const used =
    d.uses === 0
      ? d.maxUses !== null
        ? `ещё не использовали · можно ${d.maxUses} ${pluralRu(d.maxUses, "раз", "раза", "раз")}`
        : "ещё не использовали"
      : d.maxUses !== null
        ? `использована ${times} из ${d.maxUses}`
        : `использована ${times}`
  const given = d.given
    .filter((g) => g.amount > 0)
    .map((g) => formatAmount(g.amount, g.currency))
  return given.length > 0 ? `${used} · скидок на ${given.join(" + ")}` : used
}

export type DiscountStatus = "active" | "scheduled" | "expired" | "exhausted" | "archived"

// A status word only when the discount isn't working now.
export const DISCOUNT_STATUS_LABEL: Record<DiscountStatus, string | null> = {
  active: null,
  scheduled: "Ещё не началась",
  expired: "Закончилась",
  exhausted: "Лимит исчерпан",
  archived: "В архиве",
}

// ---- «Кто давал скидки» ----

type StaffPart = { count: number; amount: number }

const payments = (n: number): string => `${n} ${pluralRu(n, "оплата", "оплаты", "оплат")}`

// «Петров — разовые 3 400 ₽ (5 оплат) · из списка 1 200 ₽ (3)»: only the
// non-zero parts; the first shown part names the unit.
export const staffDiscountLine = (s: {
  name: string
  currency: string
  oneOff: StaffPart
  named: StaffPart
}): string => {
  const parts = [
    s.oneOff.amount > 0 ? { label: "разовые", part: s.oneOff } : null,
    s.named.amount > 0 ? { label: "из списка", part: s.named } : null,
  ]
    .filter((p): p is { label: string; part: StaffPart } => p !== null)
    .map(
      ({ label, part }, i) =>
        `${label} ${formatAmount(part.amount, s.currency)} (${i === 0 ? payments(part.count) : part.count})`,
    )
  return `${s.name} — ${parts.join(" · ")}`
}

// ---- The sale and mark-paid forms ----

export type SaleItem = {
  planId: string | null
  eventId: string | null
  listPrice: number
  amount: number
  currency: string
}

export type SaleOptionLike = {
  discountId: string
  name: string
  kind: "PERCENT" | "FIXED"
  value: number
  isFamily: boolean
  items: readonly SaleItem[]
}

// One entry of the «Скидка» select: «Семейная −10% — 3 600 ₽».
export type DiscountChoice = {
  discountId: string
  label: string
  // What the server prices this item at with the discount; null when it
  // can't say for this sale (the sale's recorded price differs from today's).
  amount: number | null
  isFamily: boolean
}

// The choices for one tariff (`planId`) or one event (`eventId`). `listPrice`
// (mark-paid) keeps an option's amount only when the server priced it from
// the same list price the sale recorded.
export const discountChoices = (
  options: readonly SaleOptionLike[],
  target: { planId: string } | { eventId: string },
  listPrice?: number,
): DiscountChoice[] =>
  options.flatMap((o) => {
    const item = o.items.find((i) =>
      "planId" in target ? i.planId === target.planId : i.eventId === target.eventId,
    )
    if (!item) return []
    const amount = listPrice === undefined || listPrice === item.listPrice ? item.amount : null
    const size = discountSizeText({ kind: o.kind, value: o.value, currency: item.currency })
    return [
      {
        discountId: o.discountId,
        label:
          amount === null
            ? `${o.name} ${size}`
            : `${o.name} ${size} — ${formatAmount(amount, item.currency)}`,
        amount,
        isFamily: o.isFamily,
      },
    ]
  })

// The family choice is preselected when present.
export const preselectedChoice = (choices: readonly DiscountChoice[]): string =>
  choices.find((c) => c.isFamily)?.discountId ?? ""

// Under a typed amount below the priced one: transparency, not a warning.
export const oneOffLine = (priced: number, typed: number | null, currency: string): string | null =>
  typed !== null && typed < priced
    ? `Разовая скидка −${formatAmount(priced - typed, currency)} к цене по тарифу — будет видна в «Платежах»`
    : null
