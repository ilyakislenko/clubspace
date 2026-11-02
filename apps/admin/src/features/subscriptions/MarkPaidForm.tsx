"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import {
  lastPaymentMethod,
  rememberPaymentMethod,
  type ClubPaymentMethod,
} from "./payment-method"
import { PaymentMethodPicker } from "./PaymentMethodPicker"
import { currencySymbol } from "./subscription-display"

export const MAX_PAYMENT = 10_000_000

// Confirms a payment: the amount really received, prefilled with the agreed
// price (change it for a discount or a part-payment), and how it was paid —
// the last way picked in this browser, «Наличные» the first time. Render it
// with a `key` of the row being paid — the amount is initial state, so
// another row must remount.
export function MarkPaidForm({
  amount,
  currency,
  busy,
  onSubmit,
  onCancel,
}: {
  amount: number
  currency: string
  busy: boolean
  onSubmit: (amount: number, method: ClubPaymentMethod) => void
  onCancel: () => void
}) {
  const [amountText, setAmountText] = useState(String(amount))
  const value = parseIntInput(amountText, { min: 0, max: MAX_PAYMENT })
  const [method, setMethod] = useState<ClubPaymentMethod>(lastPaymentMethod)

  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">Получено, {currencySymbol(currency)}</span>
        <input
          className={`${inputCls} w-32`}
          inputMode="numeric"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">Способ оплаты</span>
        <PaymentMethodPicker value={method} onChange={setMethod} disabled={busy} />
      </div>
      {value === null && (
        <p className="text-xs text-destructive">
          Введите сумму целым числом от 0 до {MAX_PAYMENT}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          disabled={value === null || busy}
          onClick={() => {
            if (value === null) return
            rememberPaymentMethod(method)
            onSubmit(value, method)
          }}
        >
          {busy ? "…" : "Подтвердить оплату"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  )
}
