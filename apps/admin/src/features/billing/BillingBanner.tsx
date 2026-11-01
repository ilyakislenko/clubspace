"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  acceptWorkspaceLegal,
  getWorkspaceBilling,
  type WorkspaceBilling,
  type WorkspaceLegal,
} from "../../shared/api/billing"
import { errorMessage } from "../../shared/lib/error-message"
import { isWorkspaceAdmin } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { BANNER_TONE_CLASS, billingBanner, isConflictError, legalBanner } from "./billing-view"
import { LegalDocLink } from "./LegalDocLink"

// Fired on window once the owner accepts (here or in the «Тариф» page's
// «Договор» block): the banner and the «Тариф» page reload their status.
export const LEGAL_ACCEPTED_EVENT = "clubspace:legal-accepted"

// The one most important billing notice (suspended, past due, trial ending,
// outgrown tier, video overrun, tier filling up) above every club page — for
// admins only (they are the ones who can act) and never on a self-hosted
// install. Below it, for the club owner only, a non-blocking line asking to
// accept the current offer / DPA editions.
export function BillingBanner({ workspaceId }: { workspaceId: string }) {
  const canAdmin = isWorkspaceAdmin(useMyMembership(workspaceId))
  const [billing, setBilling] = useState<WorkspaceBilling | null>(null)
  const [legal, setLegal] = useState<WorkspaceLegal | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!canAdmin) return
    let alive = true
    getWorkspaceBilling({ workspaceId })
      .then((page) => {
        if (!alive) return
        setBilling(page.enabled ? page.billing : null)
        setLegal(page.enabled ? page.legal : null)
      })
      .catch(() => {
        // Cosmetic: the billing page itself reports a failure.
      })
    return () => {
      alive = false
    }
  }, [workspaceId, canAdmin, attempt])

  useEffect(() => {
    const reload = () => setAttempt((n) => n + 1)
    window.addEventListener(LEGAL_ACCEPTED_EVENT, reload)
    return () => window.removeEventListener(LEGAL_ACCEPTED_EVENT, reload)
  }, [])

  const banner = billing ? billingBanner(billing, new Date()) : null

  return (
    <>
      {banner && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${BANNER_TONE_CLASS[banner.tone]}`}
        >
          <span>{banner.text}</span>
          <Link
            href={`/workspace/${workspaceId}/billing`}
            className="font-medium underline underline-offset-4"
          >
            Тариф
          </Link>
        </div>
      )}
      {legal && (
        <LegalBannerLine
          workspaceId={workspaceId}
          legal={legal}
          onAccepted={setLegal}
          onConflict={() => setAttempt((n) => n + 1)}
        />
      )}
    </>
  )
}

function LegalBannerLine({
  workspaceId,
  legal,
  onAccepted,
  onConflict,
}: {
  workspaceId: string
  legal: WorkspaceLegal
  onAccepted: (next: WorkspaceLegal) => void
  onConflict: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notice = legalBanner(legal)
  if (!notice) return null

  const accept = async () => {
    setBusy(true)
    setError(null)
    try {
      onAccepted(
        await acceptWorkspaceLegal({
          workspaceId,
          offerVersion: legal.offerVersion,
          dpaVersion: legal.dpaVersion,
        }),
      )
      window.dispatchEvent(new Event(LEGAL_ACCEPTED_EVENT))
    } catch (e) {
      setError(errorMessage(e, "Не удалось принять договор."))
      // The editions changed meanwhile: reload to show the new ones.
      if (isConflictError(e)) onConflict()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${BANNER_TONE_CLASS[notice.tone]}`}
    >
      <span>
        {notice.text}{" "}
        <LegalDocLink doc="offer" version={legal.offerVersion}>
          Договор-оферта
        </LegalDocLink>
        {" · "}
        <LegalDocLink doc="dpa" version={legal.dpaVersion}>
          Поручение
        </LegalDocLink>
        {error && <span className="block text-destructive">{error}</span>}
      </span>
      <Button size="sm" disabled={busy} onClick={() => void accept()}>
        Принять
      </Button>
    </div>
  )
}
