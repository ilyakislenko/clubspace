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
