import { type ClubVocabulary, fromFirstSession } from "@clubspace/ui-kit/brand"

import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "./payment-method"

// Pure display helpers for an abonement's period. An abonement sold on a
// «срок с первой тренировки» tariff has no dates until the member's first visit.

type PeriodSubscription = {
  startDate: string | null
  endDate: string | null
  durationDays: number | null
  createdAt: string
}

// A first-visit abonement starts by itself this many days after the sale.
const FIRST_VISIT_AUTO_START_DAYS = 14

// The latest start (dd.mm.yyyy): 14 days after the sale day on the browser's
// calendar.
const latestStart = (createdAt: string): string => {
  const d = new Date(createdAt)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + FIRST_VISIT_AUTO_START_DAYS)
  return d.toLocaleDateString("ru-RU")
}

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("ru-RU") : "—"

export const isPending = (s: { startDate: string | null }): boolean =>
  s.startDate === null

export const periodLabel = (
  s: PeriodSubscription,
  vocabulary: ClubVocabulary,
): string => {
  if (s.startDate === null) {
    const base = `${fromFirstSession(vocabulary)} (не позже ${latestStart(s.createdAt)})`
    return s.durationDays != null ? `${base} · ${s.durationDays} дн.` : base
  }
  return `${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`
}

const moneyFmt = new Intl.NumberFormat("ru-RU")

// «₽» for roubles, the ISO code for anything else.
export const currencySymbol = (currency: string): string =>
  currency === "RUB" ? "₽" : currency

export const formatAmount = (amount: number, currency: string): string =>
  `${moneyFmt.format(amount)} ${currencySymbol(currency)}`

// What a sale gave off its list price: the named discount (snapshot) and the
// one-off part with who set the price. Rows from before discounts have none.
type DiscountedSale = {
  discountName: string | null
  oneOffDiscount: number
  pricedBy?: { name: string } | null
  currency: string
}

// «скидка «Семейная» · разовая скидка 1 000 ₽ · Петров»; null when none.
export const saleDiscountText = (s: DiscountedSale): string | null => {
  const parts = [
    s.discountName ? `скидка «${s.discountName}»` : null,
    s.oneOffDiscount > 0
      ? [`разовая скидка ${formatAmount(s.oneOffDiscount, s.currency)}`, s.pricedBy?.name]
          .filter(Boolean)
          .join(" · ")
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

type PaymentSubscription = DiscountedSale & {
  isPaid: boolean
  paidAt: string | null
  paymentMethod: PaymentMethod | null
  amountPaid: number
  // Σ of the sale's refunds (0 = none).
  refundedAmount: number
}

// «Оплачено 5 000 ₽ · Наличные · 22.10.2026 · возвращено 1 000 ₽ · скидка
// «Семейная»» / «Ожидает оплаты: 5 000 ₽ · разовая скидка 500 ₽ · Петров». A
// payment whose method was not recorded (before it was, or imported) skips
// it; rows from before payment tracking have no payment date, so the date
// part is dropped too.
export const paymentLabel = (s: PaymentSubscription): string => {
  const amount = formatAmount(s.amountPaid, s.currency)
  const discount = saleDiscountText(s)
  if (!s.isPaid) return [`Ожидает оплаты: ${amount}`, discount].filter(Boolean).join(" · ")
  return [
    `Оплачено ${amount}`,
    s.paymentMethod ? PAYMENT_METHOD_LABEL[s.paymentMethod] : null,
    s.paidAt ? fmtDate(s.paidAt) : null,
    s.refundedAmount > 0 ? `возвращено ${formatAmount(s.refundedAmount, s.currency)}` : null,
    discount,
  ]
    .filter(Boolean)
    .join(" · ")
}

// «Отменить отметку оплаты» (an abonement or a ticket): not once money went
// back (the refund would point at an unpaid sale), and never for an online
// payment — method ONLINE or an abonement sold through the provider
// (`source` GATEWAY); its refund goes through «Платежи». Mirrors
// SubscriptionService.unmarkPaid / unmark-event-registration-paid (tickets
// have no `source`).
export const canUndoPaymentMark = (s: {
  paymentMethod: PaymentMethod | null
  refundedAmount: number
  source?: string
}): boolean => s.refundedAmount === 0 && s.paymentMethod !== "ONLINE" && s.source !== "GATEWAY"

// A paid abonement's row in «Абонементы → Платежи» (club admins).
export const paymentEntryHref = (workspaceId: string, subscriptionId: string): string =>
  `/workspace/${workspaceId}/subscriptions/payments?entry=sub:${subscriptionId}`

// A paid ticket's row there.
export const ticketEntryHref = (workspaceId: string, registrationId: string): string =>
  `/workspace/${workspaceId}/subscriptions/payments?entry=reg:${registrationId}`

// «Занятий: 3 / 12» for a class pack; null for a time-based abonement.
export const classesLabel = (s: {
  classesTotal: number | null
  classesRemaining: number | null
}): string | null =>
  s.classesTotal === null
    ? null
    : `Занятий: ${s.classesRemaining ?? 0} / ${s.classesTotal}`

const sameScope = (
  a: readonly { id: string }[],
  b: readonly { id: string }[],
): boolean => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id))

// A sale only renews a current abonement of the SAME scope (direction set;
// empty = whole club), so the coach's latest start date is that one's
// `renewFrom`. Null when no current abonement shares the tariff's scope.
export const renewFromForPlan = (
  plan: { directions: readonly { id: string }[] },
  abonements: readonly {
    directions: readonly { id: string }[]
    renewFrom: string | null
  }[],
): string | null =>
  abonements.find((a) => sameScope(a.directions, plan.directions))
    ?.renewFrom ?? null
