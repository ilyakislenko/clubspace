import type { ApiTypes } from "@clubspace/api-client"

// How staff were paid at the club (ONLINE is the checkout's, never picked).
export type ClubPaymentMethod = NonNullable<ApiTypes.MarkSubscriptionPaidInput["method"]>
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

export const isClubPaymentMethod = (v: string | null): v is ClubPaymentMethod =>
  CLUB_PAYMENT_METHODS.includes(v as ClubPaymentMethod)
