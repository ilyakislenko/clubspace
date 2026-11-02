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

type PaymentSubscription = {
  isPaid: boolean
  paidAt: string | null
  paymentMethod: PaymentMethod | null
  amountPaid: number
  currency: string
}

// «Оплачено 5 000 ₽ · Наличные · 22.10.2026» / «Ожидает оплаты: 5 000 ₽». A
// payment whose method was not recorded (before it was, or imported) skips
// it; rows from before payment tracking have no payment date, so the date
// part is dropped too.
export const paymentLabel = (s: PaymentSubscription): string => {
  const amount = formatAmount(s.amountPaid, s.currency)
  if (!s.isPaid) return `Ожидает оплаты: ${amount}`
  return [
    `Оплачено ${amount}`,
    s.paymentMethod ? PAYMENT_METHOD_LABEL[s.paymentMethod] : null,
    s.paidAt ? fmtDate(s.paidAt) : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

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
