"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { getWorkspaceBilling, type WorkspaceBilling } from "../../shared/api/billing"
import { isWorkspaceAdmin } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { billingBanner } from "./billing-view"

const TONE_CLASS = {
  info: "border-sky-300 bg-sky-50 text-sky-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
} as const

// Trial ending / past due / suspended, above every club page — for admins only
// (they are the ones who can act) and never on a self-hosted install.
export function BillingBanner({ workspaceId }: { workspaceId: string }) {
  const canAdmin = isWorkspaceAdmin(useMyMembership(workspaceId))
  const [billing, setBilling] = useState<WorkspaceBilling | null>(null)

  useEffect(() => {
    if (!canAdmin) return
    let alive = true
    getWorkspaceBilling({ workspaceId })
      .then((page) => alive && setBilling(page.enabled ? page.billing : null))
      .catch(() => {
        // Cosmetic: the billing page itself reports a failure.
      })
    return () => {
      alive = false
    }
  }, [workspaceId, canAdmin])

  const banner = billing ? billingBanner(billing, new Date()) : null
  if (!banner) return null

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${TONE_CLASS[banner.tone]}`}
    >
      <span>{banner.text}</span>
      <Link
        href={`/workspace/${workspaceId}/billing`}
        className="font-medium underline underline-offset-4"
      >
        Тариф и лимиты
      </Link>
    </div>
  )
}
