import type { PaymentStatus } from "../../shared/api/payments"
import { formatMoney, formatRuDay } from "../../shared/format-ru"
import {
  classesWord,
  type SubscriptionState,
} from "../subscription/subscription-state"

// The provider's webhook usually lands within seconds of paying.
export const POLL_INTERVAL_MS = 3000
// Past this a still-pending payment is most likely abandoned on the provider's
// page; polling stops and the member can re-check by hand.
export const POLL_WINDOW_MS = 10 * 60 * 1000

export const PENDING_TEXT = "Ожидаем подтверждение оплаты…"

type PlanLike = {
  price: number
  currency: string
  durationDays: number
  classCount: number | null
}

export const planPriceText = (plan: PlanLike): string =>
  formatMoney(plan.price, plan.currency)

// «30 дн. · 8 занятий» / «30 дн. · безлимит» — as the coach's plan list reads.
export const planTermsText = (plan: PlanLike): string =>
  [
    `${plan.durationDays} дн.`,
    plan.classCount != null
      ? `${plan.classCount} ${classesWord(plan.classCount)}`
      : "безлимит",
  ].join(" · ")

// `renewalFrom` is a club-local calendar day (YYYY-MM-DD).
export const renewalNote = (renewalFrom: string): string =>
  `Новый абонемент начнётся ${formatRuDay(renewalFrom)}`

// «Применить» quotes at most this many tariffs at once (the server allows 20
// quotes a minute per member, and the apply itself may be repeated); the rest
// are quoted one by one when the member taps their «Оплатить».
export const PROMO_QUOTE_AT_ONCE = 15
// Quotes in flight together.
const PROMO_QUOTE_CONCURRENCY = 5

// The tariffs «Применить» quotes now, in batches of a few at a time, and
// whether any are left for their own «Оплатить».
export const promoQuotePlan = (
  planIds: string[],
): { batches: string[][]; deferred: boolean } => {
  const now = planIds.slice(0, PROMO_QUOTE_AT_ONCE)
  const batches: string[][] = []
  for (let i = 0; i < now.length; i += PROMO_QUOTE_CONCURRENCY) {
    batches.push(now.slice(i, i + PROMO_QUOTE_CONCURRENCY))
  }
  return { batches, deferred: planIds.length > now.length }
}

export const PROMO_DEFERRED_NOTE =
  "Остальные тарифы проверим с промокодом, когда вы нажмёте «Оплатить»"

// The discount a price was quoted with (the checkout quote's `discount`).
type QuotedDiscount = {
  name: string
  code: string | null
  isFamily: boolean
  endsOn: string | null
}

// What the member pays for a tariff or a ticket: the amount, the list price
// to strike through when the amount is lower, and the discount's terms (its
// end day included — the member sees them before paying).
export type OfferPrice = {
  amount: string
  listPrice: string | null
  note: string | null
}

export const offerPrice = (p: {
  listPrice: number
  amount: number
  currency: string
  discount: QuotedDiscount | null
}): OfferPrice => {
  const amount = formatMoney(p.amount, p.currency)
  if (!p.discount || p.amount >= p.listPrice) {
    return { amount, listPrice: null, note: null }
  }
  const d = p.discount
  const how = d.code
    ? `Промокод ${d.code}`
    : d.isFamily
      ? "Семейная скидка"
      : `Скидка «${d.name}»`
  return {
    amount,
    listPrice: formatMoney(p.listPrice, p.currency),
    note: d.endsOn ? `${how} · до ${formatRuDay(d.endsOn)}` : how,
  }
}

// An online tariff as the options list prices it: `discountName` is set only
// by the automatic family discount (promo codes go through the quote).
export const onlinePlanOffer = (plan: {
  price: number
  amount: number
  currency: string
  discountName: string | null
}): OfferPrice =>
  offerPrice({
    listPrice: plan.price,
    amount: plan.amount,
    currency: plan.currency,
    discount: plan.discountName
      ? { name: plan.discountName, code: null, isFamily: true, endsOn: null }
      : null,
  })

// The discount part of a sale for staff: «скидка «Семейная» −400 ₽»,
// «разовая скидка 1 000 ₽ · Петров», or both joined. `oneOffDiscount` is the
// server's derived remainder (list price − named discount − amount); null when
// the sale has no discount (or was sold before prices were recorded).
export const discountedPriceText = (s: {
  currency: string
  discountName: string | null
  discountAmount: number
  oneOffDiscount: number
  pricedBy?: { name: string } | null
}): string | null => {
  const parts: string[] = []
  if (s.discountName && s.discountAmount > 0) {
    parts.push(
      `скидка «${s.discountName}» −${formatMoney(s.discountAmount, s.currency)}`,
    )
  }
  if (s.oneOffDiscount > 0) {
    parts.push(`разовая скидка ${formatMoney(s.oneOffDiscount, s.currency)}`)
    if (s.pricedBy) parts.push(s.pricedBy.name)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

// «Мой абонемент»: the member's payment line names the club discount only.
export const memberDiscountText = (s: {
  discountName: string | null
}): string | null => (s.discountName ? `со скидкой «${s.discountName}»` : null)

// The muted line under a staff amount typed below the price (the tariff's,
// or the chosen discount's): transparency, not a warning.
export const oneOffLine = (
  price: number,
  typed: number | null,
  currency: string,
): string | null =>
  typed !== null && typed < price
    ? `Разовая скидка −${formatMoney(price - typed, currency)} к цене по тарифу — будет видна в «Платежах»`
    : null

// A club discount in the staff sale picker: «Семейная −10% — 3 600 ₽».
export const saleOptionLabel = (
  option: {
    name: string
    kind: "PERCENT" | "FIXED"
    value: number
  },
  item: { amount: number; currency: string },
): string =>
  `${option.name} −${
    option.kind === "PERCENT"
      ? `${option.value}%`
      : formatMoney(option.value, item.currency)
  } — ${formatMoney(item.amount, item.currency)}`

// The club discounts usable on one tariff, each with its priced item, the
// family one first (the sale form preselects it). `listPrice` narrows to items
// priced from that list price — marking an old sale paid reprices from the
// sale's own list price, so a tariff whose price changed since offers none.
export const saleOptionsForPlan = <
  O extends {
    isFamily: boolean
    items: {
      planId: string | null
      listPrice: number
      amount: number
      currency: string
    }[]
  },
>(
  options: O[],
  planId: string,
  listPrice?: number,
): { option: O; item: O["items"][number] }[] =>
  options
    .flatMap((option) => {
      const item = option.items.find(
        (i) =>
          i.planId === planId &&
          (listPrice === undefined || i.listPrice === listPrice),
      )
      return item ? [{ option, item }] : []
    })
    .sort((a, b) => Number(b.option.isFamily) - Number(a.option.isFamily))

// The status line of a payment, worded for the member. A ticket payment
// (eventRegistrationId set) marks the event registration paid instead of
// creating an abonement.
export const paymentStatusLine = (p: {
  status: PaymentStatus
  activationError: string | null
  eventRegistrationId?: string | null
}): SubscriptionState => {
  const ticket = !!p.eventRegistrationId
  switch (p.status) {
    case "PENDING":
      return { text: PENDING_TEXT, tone: "muted" }
    case "SUCCEEDED":
      // Paid, but the server could not create the abonement / mark the
      // ticket by itself (the place was given up meanwhile, …).
      if (p.activationError) {
        return {
          text: ticket
            ? "Оплата получена, но место не подтверждено — клуб вернёт деньги"
            : "Оплата получена. Абонемент оформит администратор клуба",
          tone: "warn",
        }
      }
      return ticket
        ? { text: "Оплата прошла — билет оплачен", tone: "ok" }
        : { text: "Оплата прошла — абонемент оформлен", tone: "ok" }
    case "CANCELED":
      return { text: "Оплата не завершена", tone: "danger" }
    case "REFUNDED":
      return { text: "Платёж возвращён", tone: "muted" }
  }
}

// Keep asking while the payment is pending and the window has not run out.
export const shouldKeepPolling = (
  status: PaymentStatus,
  startedAt: number,
  now: number,
): boolean => status === "PENDING" && now - startedAt < POLL_WINDOW_MS

// The payment id in the provider's return URL (`<app>/payment/<id>`), or null.
export const paymentIdFromUrl = (url: string): string | null => {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/[^/]*)?\/payment\/([^/?#]+)\/?(?:[?#]|$)/i.exec(
    url,
  )
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
