import type {
  PaymentMode,
  PaymentProvider,
  PaymentStatus,
  PaymentSubject,
} from "../../shared/api/payments"

export const PROVIDER_LABEL: Record<PaymentProvider, string> = {
  YOOKASSA: "ЮKassa",
  STRIPE: "Stripe",
}

// 54-ФЗ VAT codes as ЮKassa numbers them (receipt.items[].vat_code).
export const VAT_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Без НДС" },
  { value: 2, label: "НДС 0%" },
  { value: 3, label: "НДС 10%" },
  { value: 4, label: "НДС 20%" },
  { value: 5, label: "НДС 10/110" },
  { value: 6, label: "НДС 20/120" },
  { value: 7, label: "НДС 5%" },
  { value: 8, label: "НДС 7%" },
  { value: 9, label: "НДС 5/105" },
  { value: 10, label: "НДС 7/107" },
  { value: 11, label: "НДС 22%" },
  { value: 12, label: "НДС 22/122" },
]

export const PAYMENT_SUBJECT_LABEL: Record<PaymentSubject, string> = {
  service: "Услуга",
  another: "Иной предмет расчёта",
}

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  full_prepayment: "Полная предоплата",
  full_payment: "Полный расчёт",
  advance: "Аванс",
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Ожидает оплаты",
  SUCCEEDED: "Оплачен",
  CANCELED: "Отменён",
  REFUNDED: "Возвращён",
}

export const PAYMENT_STATUS_CLASS: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  SUCCEEDED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CANCELED: "bg-zinc-100 text-zinc-700 ring-zinc-600/20",
  REFUNDED: "bg-sky-50 text-sky-700 ring-sky-600/20",
}

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
