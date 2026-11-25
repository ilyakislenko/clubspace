"use client"

import { useCallback, useEffect, useState } from "react"

import { listOrgAuditEvents } from "../../../../../shared/api/organizations"
import { AuditFeed } from "../../../../../features/audit/AuditFeed"
import { useOrg } from "../../../../../features/org/org-context"
import { OrgProfileForm } from "../../../../../features/org/OrgProfileForm"

type Tab = "profile" | "history"

const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "Профиль" },
  { id: "history", label: "История изменений" },
]

// «Настройки» of the federation: its profile and, on ?tab=history, the
// journal (its own actions and the clubs' decisions about it).
export default function OrgSettingsPage() {
  const { org, reload } = useOrg()
  const [tab, setTab] = useState<Tab>("profile")

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "history") setTab("history")
  }, [])

  const switchTab = (next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === "history") url.searchParams.set("tab", "history")
    else url.searchParams.delete("tab")
    window.history.replaceState(null, "", url)
  }

  const loadAudit = useCallback(
    (p: { curPage: number; perPage: number }) => listOrgAuditEvents({ organizationId: org.id, ...p }),
    [org.id],
  )

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Настройки</h1>
      <div role="tablist" aria-label="Настройки федерации" className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={`relative -mb-px px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "history" ? (
        <AuditFeed load={loadAudit} emptyHint="Здесь появятся изменения команды федерации и решения клубов." />
      ) : (
        <OrgProfileForm org={org} onSaved={reload} />
      )}
    </div>
  )
}
