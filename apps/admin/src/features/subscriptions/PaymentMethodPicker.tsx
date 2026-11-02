"use client"

import {
  CLUB_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type ClubPaymentMethod,
} from "./payment-method"

// «Наличные / Перевод / Карта в клубе» — how a payment at the club was taken.
export function PaymentMethodPicker({
  value,
  onChange,
  disabled,
}: {
  value: ClubPaymentMethod
  onChange: (method: ClubPaymentMethod) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Способ оплаты">
      {CLUB_PAYMENT_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          disabled={disabled}
          onClick={() => onChange(m)}
          className={`rounded-md border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
            value === m
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:bg-muted"
          }`}
        >
          {PAYMENT_METHOD_LABEL[m]}
        </button>
      ))}
    </div>
  )
}
