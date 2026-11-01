"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { setBillingModule, type BillingModule } from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { formatAmount } from "../subscriptions/subscription-display"
import { LEGAL_SECTION_ID } from "./BillingLegalSection"
import {
  MODULE_ACTION_LABEL,
  moduleAction,
  moduleActionConfirm,
  moduleOutcomeBanner,
  type Banner,
} from "./billing-view"

// The club connects, disconnects or keeps a paid module itself. A paid
// connection mid-period charges the saved card or opens YooKassa's page.
export function BillingModuleAction({
  workspaceId,
  module: m,
  currency,
  cardLast4,
  currentPeriodEnd,
  legalRequired,
  onDone,
}: {
  workspaceId: string
  module: BillingModule
  currency: string
  cardLast4: string | null
  currentPeriodEnd: string | null
  // Acceptance of the current offer is overdue: connecting is refused.
  legalRequired: boolean
  onDone: (notice: Banner) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `mode` is null at runtime when the platform set nothing (the generated
  // type misses the null).
  const { action, note } = moduleAction({
    source: m.source,
    mode: m.mode as string | null,
    cancelAt: m.cancelAt,
  })

  const run = async () => {
    if (!action) return
    const question = moduleActionConfirm(action, m, { currency, cardLast4, currentPeriodEnd })
    if (question && !window.confirm(question)) return
    setBusy(true)
    setError(null)
    try {
      const r = await setBillingModule({
        workspaceId,
        module: m.code,
        enabled: action !== "disconnect",
      })
      if (r.outcome === "PAYMENT_REQUIRED" && r.confirmationUrl) {
        window.location.assign(r.confirmationUrl)
        return
      }
      onDone(moduleOutcomeBanner(r.outcome, m.name, currentPeriodEnd))
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить модуль."))
    }
    setBusy(false)
  }

  // COMP and self-hosted modules: nothing for the club to do.
  if (!action && !note) return null

  return (
    <div className="space-y-1 border-t pt-2">
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {action === "connect" && (
        <p className="text-xs text-muted-foreground">
          {m.connectPrice !== null && m.connectPrice > 0
            ? `Подключение сейчас — ${formatAmount(m.connectPrice, currency)} за остаток оплаченного периода`
            : m.source === "TRIAL"
              ? "Останется после пробного периода — оплата в следующем счёте"
              : "Подключится сразу, оплата — в следующем счёте"}
        </p>
      )}
      {action && (
        <Button
          size="sm"
          variant={action === "disconnect" ? "ghost" : "secondary"}
          disabled={busy || (legalRequired && action !== "disconnect")}
          onClick={() => void run()}
        >
          {MODULE_ACTION_LABEL[action]}
        </Button>
      )}
      {legalRequired && action && action !== "disconnect" && (
        <p className="text-xs text-destructive">
          Недоступно, пока владелец не примет новую редакцию договора — см.{" "}
          <a href={`#${LEGAL_SECTION_ID}`} className="underline underline-offset-4">
            блок «Договор»
          </a>
          .
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
