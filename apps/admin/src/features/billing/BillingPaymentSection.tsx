"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  removeBillingCard,
  setBillingPeriod,
  startBillingCheckout,
  type WorkspaceBilling,
} from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"
import { formatDay, type Banner } from "./billing-view"
import { QuoteSummary } from "./QuoteSummary"

type PeriodMonths = 1 | 12

// The «Оплата» block of the club's «Тариф» page: monthly or annual, paid by
// card on YooKassa's page — or, once a card is saved and the club is active,
// just how the automatic renewals are charged. Below it, the saved card and
// the state of autopay (failed attempts included).
export function BillingPaymentSection({
  workspaceId,
  billing,
  annualDiscountPercent,
  onChanged,
}: {
  workspaceId: string
  billing: WorkspaceBilling
  annualDiscountPercent: number
  onChanged: (notice: Banner) => void
}) {
  const { autopay, checkout } = billing
  const savedPeriod: PeriodMonths = billing.billingPeriodMonths === 12 ? 12 : 1
  const [period, setPeriod] = useState<PeriodMonths>(savedPeriod)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const card = autopay.card
  // With a saved card the club's renewals are charged automatically: the
  // choice only says for how long each renewal is.
  const renewsByCard =
    autopay.available && autopay.enabled && card !== null && billing.status === "ACTIVE"
  const quote = period === 12 ? checkout.annual : checkout.monthly
  const currency = quote.currency

  const pay = async (periodMonths: PeriodMonths) => {
    setBusy(true)
    setError(null)
    try {
      const { confirmationUrl } = await startBillingCheckout({ workspaceId, periodMonths })
      window.location.assign(confirmationUrl)
    } catch (e) {
      setError(errorMessage(e, "Не удалось перейти к оплате."))
      setBusy(false)
    }
  }

  const savePeriod = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await setBillingPeriod({ workspaceId, periodMonths: period })
      onChanged({
        tone: "success",
        text:
          r.billingPeriodMonths === 12
            ? "Продления будут списываться за год."
            : "Продления будут списываться помесячно.",
      })
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить период оплаты."))
    } finally {
      setBusy(false)
    }
  }

  const removeCard = async () => {
    if (!card) return
    const ok = window.confirm(
      `Удалить карту${card.last4 ? ` •••• ${card.last4}` : ""}? Автосписание выключится — продление нужно будет оплачивать вручную.`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await removeBillingCard({ workspaceId })
      onChanged({ tone: "info", text: "Карта удалена, автосписание выключено." })
    } catch (e) {
      setError(errorMessage(e, "Не удалось удалить карту."))
    } finally {
      setBusy(false)
    }
  }

  const choices: { months: PeriodMonths; label: string; hint: string | null }[] = [
    { months: 1, label: "Помесячно", hint: null },
    {
      months: 12,
      label: "За год",
      hint: annualDiscountPercent > 0 ? `скидка ${annualDiscountPercent}%` : null,
    },
  ]

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Оплата</h2>
        <p className="text-xs text-muted-foreground">
          {renewsByCard
            ? `Карта сохранена — продление спишется с неё автоматически${billing.nextChargeAt ? ` ${formatDay(billing.nextChargeAt)}` : ""}. Выберите, за какой срок списывать.`
            : `Оплаченный период начнётся ${formatDay(checkout.periodStart)}.`}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {choices.map((c) => {
          const q = c.months === 12 ? checkout.annual : checkout.monthly
          const selected = period === c.months
          return (
            <label
              key={c.months}
              className={`cursor-pointer space-y-2 rounded-md border p-3 ${
                selected ? "border-primary bg-primary/5" : ""
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="billing-period"
                  checked={selected}
                  disabled={busy}
                  onChange={() => setPeriod(c.months)}
                />
                {c.label}
                {c.hint && <span className="text-xs text-emerald-700">{c.hint}</span>}
                {renewsByCard && c.months === savedPeriod && (
                  <span className="text-xs text-primary">сейчас</span>
                )}
              </span>
              <QuoteSummary quote={q} nextChargeAt={null} />
            </label>
          )
        })}
      </div>

      {!autopay.available ? (
        <p className="text-sm text-muted-foreground">
          Оплата картой пока недоступна. Оплата по счёту — напишите нам.
        </p>
      ) : renewsByCard ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy || period === savedPeriod} onClick={savePeriod}>
            Сохранить
          </Button>
          <span className="text-xs text-muted-foreground">
            Сейчас ничего не спишется: выбранный срок применится к следующему продлению.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => void pay(period)}>
            Оплатить картой {formatAmount(quote.total, currency)}
          </Button>
          <span className="text-xs text-muted-foreground">
            Откроется страница ЮKassa. Карта сохранится, и продления будут списываться
            с неё автоматически — удалить её можно здесь же.
          </span>
        </div>
      )}

      {autopay.available && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Карта и автосписание</h3>
          {card ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">
                {card.title ?? "Карта"}
                {card.last4 ? ` •••• ${card.last4}` : ""}
              </span>
              {card.savedAt && (
                <span className="text-xs text-muted-foreground">
                  сохранена {formatDay(card.savedAt)}
                </span>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={removeCard}>
                Удалить карту
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Карта не сохранена. Она сохранится при оплате картой.
            </p>
          )}
          <p className="text-sm">
            {!autopay.enabled
              ? "Автосписание выключено командой ClubSpace — продление оплачивайте сами."
              : card
                ? "Автосписание включено."
                : "Автосписание включится, когда карта будет сохранена."}
          </p>
          {autopay.failedAttempts > 0 && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p>
                Не удалось списать оплату ({autopay.failedAttempts}{" "}
                {pluralRu(autopay.failedAttempts, "попытка", "попытки", "попыток")})
                {autopay.lastError ? `: ${autopay.lastError}` : ""}.
                {autopay.nextAttemptAt
                  ? ` Следующая попытка — ${formatDay(autopay.nextAttemptAt)}.`
                  : ""}
              </p>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void pay(savedPeriod)}
              >
                Оплатить сейчас
              </Button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
