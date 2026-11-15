"use client"

import { useRef, useState } from "react"

import { Button, Input, Label, Textarea } from "@clubspace/ui-kit/ui"

import {
  createRefund,
  type CreateRefundResult,
  type RefundMethod,
} from "../../shared/api/payment-journal"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorCode, errorMessage } from "../../shared/lib/error-message"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { formatAmount } from "../subscriptions/subscription-display"
import {
  defaultRefundMethod,
  parseRefundAmount,
  refundHint,
  refundMax,
  refundMethodLabel,
  refundMethods,
  refundTargetOf,
  type RefundSubject,
} from "./journal-view"

const REASON = FORM_LIMITS.refund.reason

type Props = {
  workspaceId: string
  subject: RefundSubject
  onRefunded: (result: CreateRefundResult) => void
  onCancel: () => void
  // 409: someone refunded this sale meanwhile; the panel reloads it.
  onStale: () => void
}

/**
 * «Вернуть деньги»: how much, how and why. Replaces the panel body (no panel
 * on a panel). An offline method only records the refund (it can be deleted);
 * online sends the money back through the provider and is final, so it asks.
 */
export function RefundForm({ workspaceId, subject, onRefunded, onCancel, onStale }: Props) {
  const methods = refundMethods(subject)
  const initialMethod = defaultRefundMethod(subject)
  const initialAmount = String(refundMax(subject, initialMethod))
  const [method, setMethod] = useState<RefundMethod>(initialMethod)
  const [amountText, setAmountText] = useState(initialAmount)
  const [reason, setReason] = useState("")
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A second click before the first answer re-renders must not send twice.
  const sending = useRef(false)

  const dirty = method !== initialMethod || amountText !== initialAmount || reason.trim() !== ""
  useDirtyGuard(dirty)

  const parsed = parseRefundAmount(amountText, subject, method)
  const amount = "amount" in parsed ? parsed.amount : null
  const reasonText = reason.trim()
  const reasonError =
    reasonText.length < REASON.min ? "Укажите причину возврата" : null
  const currency = subject.kind === "sale" ? subject.entry.currency : subject.payment.currency
  const provider =
    subject.kind === "sale" ? (subject.entry.online?.provider ?? null) : subject.payment.provider
  const hint = refundHint(subject, amount)

  const cancel = async () => {
    if (await confirmLeave()) onCancel()
  }

  const submit = async () => {
    setTouched(true)
    const target = refundTargetOf(subject)
    // A second click (or Enter) while the first is asking or sending is ignored.
    if (sending.current || !target || amount === null || reasonError) return
    sending.current = true
    const sum = formatAmount(amount, currency)
    try {
      if (method === "ONLINE") {
        const ok = await confirmDialog({
          title: `Вернуть ${sum} на карту?`,
          description:
            "Деньги вернутся тем же способом, которым платил участник. Отменить возврат будет нельзя.",
          confirmLabel: `Вернуть ${sum}`,
          destructive: true,
        })
        if (!ok) return
      }
      setBusy(true)
      setError(null)
      const result = await createRefund({
        workspaceId,
        data: { ...target, amount, method, reason: reasonText },
      })
      onRefunded(result)
    } catch (e) {
      if (errorCode(e) === "CONFLICT") {
        setError("Данные изменились — проверьте сумму")
        onStale()
      } else {
        setError(errorMessage(e, "Не удалось вернуть деньги"))
      }
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="refund-amount">Сумма</Label>
        <Input
          id="refund-amount"
          inputMode="numeric"
          autoComplete="off"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          disabled={busy}
          className="w-40"
        />
        {"error" in parsed && (touched || amountText !== initialAmount) && (
          <p className="text-xs text-destructive">{parsed.error}</p>
        )}
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Как вернули</span>
        <div role="radiogroup" aria-label="Как вернули" className="space-y-1.5 text-sm">
          {methods.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="refund-method"
                checked={method === m}
                disabled={busy}
                onChange={() => setMethod(m)}
              />
              {refundMethodLabel(m, provider)}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="refund-reason">Причина</Label>
        <Textarea
          id="refund-reason"
          rows={3}
          value={reason}
          maxLength={REASON.max}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          placeholder="Например: переезд, болезнь, ошибка при оплате"
        />
        {touched && reasonError && <p className="text-xs text-destructive">{reasonError}</p>}
      </div>

      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? "Возвращаем…" : amount !== null ? `Вернуть ${formatAmount(amount, currency)}` : "Вернуть"}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
