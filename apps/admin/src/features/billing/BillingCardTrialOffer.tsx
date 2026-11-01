"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  startBillingCardCheck,
  type WorkspaceBilling,
  type WorkspaceLegal,
} from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { formatAmount } from "../subscriptions/subscription-display"
import { BillingLegalNote } from "./BillingLegalSection"

// «Пробный период с картой»: during the trial, a club without a saved card
// binds one on YooKassa's page (a small check charge, refunded at once); the
// first paid period is then charged from it when the trial ends. YooKassa
// returns to /workspace/:id/billing?payment=<id> like the checkout.
export function BillingCardTrialOffer({
  workspaceId,
  billing,
  legal,
}: {
  workspaceId: string
  billing: WorkspaceBilling
  legal: WorkspaceLegal
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { trial, autopay } = billing

  if (!trial.cardTrial || billing.status !== "TRIAL" || !autopay.available || autopay.card) {
    return null
  }

  const bind = async () => {
    setBusy(true)
    setError(null)
    try {
      const { confirmationUrl } = await startBillingCardCheck({ workspaceId })
      window.location.assign(confirmationUrl)
    } catch (e) {
      setError(errorMessage(e, "Не удалось перейти к привязке карты."))
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sky-900">
      <h2 className="text-sm font-medium">Пробный период с картой</h2>
      <p className="text-sm">
        Привяжите карту — когда пробный период закончится, первый платёж спишется
        автоматически. Для проверки спишем{" "}
        {formatAmount(trial.cardCheckAmount, billing.quote.currency)} и сразу вернём.
      </p>
      <Button size="sm" disabled={busy || legal.required} onClick={() => void bind()}>
        Привязать карту
      </Button>
      <BillingLegalNote legal={legal} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
