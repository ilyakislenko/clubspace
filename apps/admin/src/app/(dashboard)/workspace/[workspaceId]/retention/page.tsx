"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { isSportLead } from "../../../../../shared/lib/permissions"
import { useMyMembershipState } from "../../../../../shared/lib/use-my-membership"
import { CallList } from "./call-list"
import { RenewList } from "./renew-list"

type Tab = "call" | "renew"

const TABS: { id: Tab; label: string }[] = [
  { id: "call", label: "Позвонить" },
  { id: "renew", label: "Продлить" },
]

// Retention: «Позвонить» (the call list, every staff role in its scope) and
// «Продлить» (renewals and unpaid abonements — the sport leads', club-wide).
// ?tab=renew opens the second tab (the dashboard tile links there).
export default function RetentionPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const { membership, failed } = useMyMembershipState(workspaceId)
  const canRenew = isSportLead(membership)
  const [tab, setTab] = useState<Tab>("call")

  // Read from window, not useSearchParams, to avoid a Suspense boundary.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "renew") {
      setTab("renew")
    }
  }, [])

  const switchTab = (next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === "renew") url.searchParams.set("tab", "renew")
    else url.searchParams.delete("tab")
    window.history.replaceState(window.history.state, "", url)
  }

  // ?tab=renew waits for the role instead of flashing the call list; if the
  // role can't be read, the call list (every staff role's) shows instead.
  if (tab === "renew" && !membership && !failed) return null

  return (
    <div className="space-y-6">
      {canRenew && (
        <div role="tablist" aria-label="Удержание" className="flex border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              className={`relative -mb-px px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {canRenew && tab === "renew" && workspaceId ? (
        <RenewList workspaceId={workspaceId} />
      ) : (
        <CallList />
      )}
    </div>
  )
}
