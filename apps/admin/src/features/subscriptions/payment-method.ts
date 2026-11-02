import type { ApiTypes } from "@clubspace/api-client"

// How staff were paid at the club (ONLINE is the checkout's, never picked).
export type ClubPaymentMethod = ApiTypes.MarkEventRegistrationPaidInput["method"]
export type PaymentMethod = ClubPaymentMethod | "ONLINE"

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Наличные",
  TRANSFER: "Перевод",
  CARD: "Карта в клубе",
  ONLINE: "Онлайн",
}

export const CLUB_PAYMENT_METHODS: readonly ClubPaymentMethod[] = [
  "CASH",
  "TRANSFER",
  "CARD",
]

const STORAGE_KEY = "clubspace.paymentMethod"

const isClubPaymentMethod = (v: string | null): v is ClubPaymentMethod =>
  CLUB_PAYMENT_METHODS.includes(v as ClubPaymentMethod)

// The method this browser picked last — a club mostly takes one way, so the
// next payment starts there; «Наличные» the first time.
export const lastPaymentMethod = (): ClubPaymentMethod => {
  if (typeof window === "undefined") return "CASH"
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isClubPaymentMethod(stored) ? stored : "CASH"
  } catch {
    return "CASH"
  }
}

export const rememberPaymentMethod = (method: ClubPaymentMethod): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, method)
  } catch {
    // Private mode / storage off: the default is fine next time.
  }
}
