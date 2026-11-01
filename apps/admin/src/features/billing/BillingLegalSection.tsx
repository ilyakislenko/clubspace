"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { environment } from "../../environments/environment"
import { acceptWorkspaceLegal, type WorkspaceLegal } from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { LEGAL_ACCEPTED_EVENT } from "./BillingBanner"
import {
  BANNER_TONE_CLASS,
  formatDay,
  formatEdition,
  isConflictError,
  LEGAL_SOURCE_LABEL,
  legalEditionsLabel,
  legalStatusBanner,
  type Banner,
} from "./billing-view"
import { LegalDocLink, LegalDocsPhrase } from "./LegalDocLink"

// Anchor of the block: the paid buttons point here while acceptance is overdue.
export const LEGAL_SECTION_ID = "billing-legal"

// «Договор» on the club's «Тариф» page: the current offer / DPA editions,
// what the club accepted (when, how, by whom) and — for the owner only — the
// button accepting the current editions.
export function BillingLegalSection({
  workspaceId,
  legal,
  onChanged,
}: {
  workspaceId: string
  legal: WorkspaceLegal
  onChanged: (notice: Banner) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = legalStatusBanner(legal)
  const { accepted } = legal

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      await acceptWorkspaceLegal({
        workspaceId,
        offerVersion: legal.offerVersion,
        dpaVersion: legal.dpaVersion,
      })
      window.dispatchEvent(new Event(LEGAL_ACCEPTED_EVENT))
      onChanged({ tone: "success", text: "Договор-оферта и поручение приняты." })
    } catch (e) {
      const message = errorMessage(e, "Не удалось принять договор.")
      // The editions changed meanwhile: reload to show the new ones.
      if (isConflictError(e)) onChanged({ tone: "danger", text: message })
      else setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id={LEGAL_SECTION_ID} className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium">Договор</h2>
      <ul className="space-y-1 text-sm">
        <li>
          <LegalDocLink doc="offer" version={legal.offerVersion}>
            Договор-оферта
          </LegalDocLink>{" "}
          — ред. {formatEdition(legal.offerVersion)}
        </li>
        <li>
          <LegalDocLink doc="dpa" version={legal.dpaVersion}>
            Поручение на обработку персональных данных
          </LegalDocLink>{" "}
          — ред. {formatEdition(legal.dpaVersion)}
        </li>
      </ul>
      {!environment.publicAppUrl && (
        <p className="text-xs text-muted-foreground">
          Тексты опубликованы на сайте приложения в разделах /legal/offer и /legal/dpa
          (публичный адрес приложения не настроен).
        </p>
      )}

      <p className={`rounded-md border px-3 py-2 text-sm ${BANNER_TONE_CLASS[status.tone]}`}>
        {status.text}
      </p>

      <p className="text-sm">
        {accepted
          ? `Принято: ${legalEditionsLabel(accepted)} — ${formatDay(accepted.acceptedAt)}, ${LEGAL_SOURCE_LABEL[accepted.source]}${accepted.userName ? ` (${accepted.userName})` : ""}.`
          : "Клуб ещё не принимал договор."}
      </p>

      {!legal.upToDate &&
        (legal.canAccept ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Нажимая «Принять», вы как владелец клуба принимаете{" "}
              <LegalDocsPhrase offerVersion={legal.offerVersion} dpaVersion={legal.dpaVersion} />{" "}
              ({legalEditionsLabel(legal)}).
            </p>
            <Button size="sm" disabled={busy} onClick={() => void accept()}>
              Принять
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Принять договор может только владелец клуба.
          </p>
        ))}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}

// The line next to a paid button (pay, bind a card): paying accepts the
// current editions. While acceptance is overdue the buttons are disabled and
// this points to the «Договор» block instead.
export function BillingLegalNote({ legal }: { legal: WorkspaceLegal }) {
  if (legal.required) {
    return (
      <p className="text-xs text-destructive">
        Оплата недоступна, пока владелец не примет новую редакцию договора — см.{" "}
        <a href={`#${LEGAL_SECTION_ID}`} className="underline underline-offset-4">
          блок «Договор»
        </a>
        .
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      Оплачивая, вы принимаете{" "}
      <LegalDocsPhrase offerVersion={legal.offerVersion} dpaVersion={legal.dpaVersion} short /> (
      {legalEditionsLabel(legal)}).
    </p>
  )
}
