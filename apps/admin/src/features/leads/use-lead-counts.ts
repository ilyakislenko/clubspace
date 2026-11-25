"use client"

import { useCallback, useEffect, useState } from "react"

import { getLeadCounts, type LeadCounts } from "../../shared/api/leads"
import { isSportLead } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"

/**
 * The trial requests that need action — the one source of the «Пробные» tab
 * badge and the «Сегодня» row. Read only by sport leads (strangers' phones
 * are theirs); for anyone else, while loading or after a failed read it stays
 * null, so a badge or a row is absent rather than wrong. Reloads on `leads`.
 */
export function useLeadCounts(workspaceId: string | undefined): LeadCounts | null {
  const canLead = isSportLead(useMyMembership(workspaceId))
  const [counts, setCounts] = useState<LeadCounts | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId || !canLead) {
      setCounts(null)
      return
    }
    try {
      setCounts(await getLeadCounts({ workspaceId }))
    } catch {
      setCounts(null)
    }
  }, [workspaceId, canLead])

  useEffect(() => {
    void load()
  }, [load])

  useWorkspaceRealtime(workspaceId, ["leads"], () => void load())

  return counts
}
