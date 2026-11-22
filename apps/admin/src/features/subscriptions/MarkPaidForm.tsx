"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { inputCls } from "../../shared/lib/input-class"
import { parseIntInput } from "../../shared/lib/parse-int-input"
import { oneOffLine, type DiscountChoice } from "../discounts/discount-view"
import {
  lastPaymentMethod,
  rememberPaymentMethod,
  type ClubPaymentMethod,
} from "./payment-method"
import { PaymentMethodPicker } from "./PaymentMethodPicker"
import { currencySymbol } from "./subscription-display"

// An abonement's «Отметить оплату»; a ticket passes its own body's limit.
const PAID_AMOUNT = FORM_LIMITS.payment.paidAmount

// Confirms a payment: the amount really received, prefilled with the agreed
// price (change it for a discount or a part-payment — recorded as a one-off
// discount with who changed it), and how it was paid — the last way picked in
// this browser, «Наличные» the first time. «Скидка» shows when the sale may
// still take one (`choices`, priced by the server); picking it reprices the
// amount. Render it with a `key` of the row being paid — the amount is
// initial state, so another row must remount.
export function MarkPaidForm({
  amount,
  currency,
  basePrice,
  choices = [],
  preselect = "",
  limit: L = PAID_AMOUNT,
  busy,
  onSubmit,
  onCancel,
}: {
  amount: number
  currency: string
  // The price before any one-off reduction (list price − the named discount);
  // null when the sale recorded no list price (nothing to compare with).
  basePrice: number | null
  choices?: readonly DiscountChoice[]
  // The choice selected at opening ("" = «Без скидки»).
  preselect?: string
  // The «Получено» bounds of the body this form submits.
  limit?: { min: number; max: number }
  busy: boolean
  // `amount` null: the chosen discount has no price here (the sale recorded
  // another list price than today's) and nothing was typed — the server
  // prices it from the sale's list price.
  onSubmit: (amount: number | null, method: ClubPaymentMethod, discountId: string | null) => void
  onCancel: () => void
}) {
  const [discountId, setDiscountId] = useState(preselect)
  const chosen = choices.find((c) => c.discountId === discountId)
  // A priced choice prefills its amount; an unpriced one leaves the field
  // empty for the server to price (typing a number overrides it).
  const prefill = (c: DiscountChoice | undefined): string =>
    c ? (c.amount !== null ? String(c.amount) : "") : String(amount)
  const [amountText, setAmountText] = useState(prefill(chosen))
  const serverPrices = chosen !== undefined && chosen.amount === null && amountText.trim() === ""
  const value = serverPrices ? null : parseIntInput(amountText, L)
  const invalid = !serverPrices && value === null
  const [method, setMethod] = useState<ClubPaymentMethod>(lastPaymentMethod)
  // Below what was agreed (or what the chosen discount prices it at).
  const reference = chosen?.amount ?? amount
  const base = chosen ? chosen.amount : basePrice
  const oneOff =
    base !== null && value !== null && value < reference ? oneOffLine(base, value, currency) : null

  const choose = (id: string) => {
    setDiscountId(id)
    setAmountText(prefill(choices.find((c) => c.discountId === id)))
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      {choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-muted-foreground">Скидка</span>
          <select
            className={`${inputCls} min-w-0 flex-1 basis-56`}
            aria-label="Скидка"
            value={discountId}
            disabled={busy}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">Без скидки</option>
            {choices.map((c) => (
              <option key={c.discountId} value={c.discountId}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">Получено, {currencySymbol(currency)}</span>
        <input
          className={`${inputCls} w-32`}
          inputMode="numeric"
          aria-label="Получено"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
      </div>
      {oneOff && <p className="text-xs text-muted-foreground">{oneOff}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-muted-foreground">Способ оплаты</span>
        <PaymentMethodPicker value={method} onChange={setMethod} disabled={busy} />
      </div>
      {serverPrices && (
        <p className="text-xs text-muted-foreground">
          Сумму со скидкой посчитаем от цены, записанной при продаже
        </p>
      )}
      {invalid && (
        <p className="text-xs text-destructive">
          Введите сумму целым числом от {L.min} до {L.max.toLocaleString("ru-RU")}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          disabled={invalid || busy}
          onClick={() => {
            if (invalid) return
            rememberPaymentMethod(method)
            onSubmit(value, method, discountId || null)
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
