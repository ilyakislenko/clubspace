"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"

import { listOrgLadderTemplates, type OrgLadderTemplate } from "../../../../../../../shared/api/organizations"
import { useOrg } from "../../../../../../../features/org/org-context"
import { DivisionsTab } from "../../../../../../../features/org/tournament/DivisionsTab"
import { EntriesTab } from "../../../../../../../features/org/tournament/EntriesTab"
import { MatsTab } from "../../../../../../../features/org/tournament/MatsTab"
import { ResultsTab } from "../../../../../../../features/org/tournament/ResultsTab"
import { TournamentHeader } from "../../../../../../../features/org/tournament/TournamentHeader"
import {
  readQueryParam,
  setQueryParam,
  useEventTournament,
} from "../../../../../../../features/org/tournament/use-tournament"

type Tab = "divisions" | "entries" | "mats" | "results"

const TABS: { id: Tab; label: string }[] = [
  { id: "divisions", label: "Категории" },
  { id: "entries", label: "Участники" },
  { id: "mats", label: "Ковры" },
  { id: "results", label: "Итоги" },
]

// The tournament of a calendar event (docs/design/2026-11-27-tournaments.md
// §7): header with the phase action, in-page tabs on `?tab=`. «Ковры» and
// «Итоги» exist only from RUNNING on.
export default function OrgTournamentPage() {
  const { org, isAdmin } = useOrg()
  const params = useParams<{ eventId: string }>()
  const eventId = params?.eventId ?? ""
  const { state, reload, replace } = useEventTournament(org.id, eventId)
  const [tab, setTab] = useState<Tab>("divisions")
  const [templates, setTemplates] = useState<OrgLadderTemplate[]>([])

  useEffect(() => {
    const raw = readQueryParam("tab")
    if (TABS.some((t) => t.id === raw)) setTab(raw as Tab)
    listOrgLadderTemplates({ organizationId: org.id })
      .then((res) => setTemplates(res.data.filter((t) => t.isActive)))
      .catch(() => setTemplates([]))
  }, [org.id])

  if (state.kind === "loading") return <div className="h-40 max-w-5xl animate-pulse rounded-xl border border-border bg-muted" />
  if (state.kind === "missing" || state.kind === "failed") {
    return (
      <div className="max-w-3xl space-y-3 rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        <p>{state.kind === "missing" ? "У этого события нет турнира." : state.message}</p>
        <Link href={`/org/${org.id}/events`} className="font-medium text-foreground underline underline-offset-4">
          К календарю
        </Link>
      </div>
    )
  }

  const t = state.tournament
  const started = t.status === "RUNNING" || t.status === "FINISHED"
  const tabs = TABS.filter((x) => started || (x.id !== "mats" && x.id !== "results"))
  const current = tabs.some((x) => x.id === tab) ? tab : "divisions"

  const switchTab = (next: Tab) => {
    setTab(next)
    setQueryParam("tab", next === "divisions" ? null : next)
    if (next !== "mats") setQueryParam("mat", null)
    if (next !== "entries") setQueryParam("filter", null)
  }

  return (
    <div className="max-w-5xl space-y-6">
      <TournamentHeader tournament={t} isAdmin={isAdmin} onChanged={replace} onReload={reload} />
      <div role="tablist" aria-label="Разделы турнира" className="flex overflow-x-auto border-b border-border">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={current === x.id}
            onClick={() => switchTab(x.id)}
            className={`relative -mb-px min-h-12 px-4 text-sm font-medium transition-colors ${
              current === x.id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {current === "divisions" && (
        <DivisionsTab tournament={t} templates={templates} orgType={org.type} onChanged={() => void reload()} />
      )}
      {current === "entries" && <EntriesTab tournament={t} onChanged={() => void reload()} />}
      {current === "mats" && <MatsTab tournament={t} orgType={org.type} onChanged={() => void reload()} />}
      {current === "results" && <ResultsTab tournament={t} />}
    </div>
  )
}
