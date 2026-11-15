"use client"

import { useCallback, useEffect, useState } from "react"

import {
  getOpenRequestCounts,
  type OpenRequestsPage,
  type RequestCounts,
  type RequestKind,
} from "../../shared/api/requests"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"

export type RequestSummary = { counts: RequestCounts; kinds: RequestKind[] }

const summaryOf = (page: OpenRequestsPage): RequestSummary => ({
  counts: page.counts,
  kinds: page.kinds,
})

/**
 * What waits for this viewer's decision, per kind — the one source of the
 * «Ученики» tab badge and the «Сегодня» row (the server scopes it to what the
 * viewer may decide). Null while loading or after a failed read, so a badge
 * or a row is absent rather than wrong. Reloads on the `requests` signal.
 */
export function useRequestCounts(workspaceId: string | undefined): RequestSummary | null {
  const [summary, setSummary] = useState<RequestSummary | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setSummary(summaryOf(await getOpenRequestCounts({ workspaceId })))
    } catch {
      setSummary(null)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  useWorkspaceRealtime(workspaceId, ["requests"], () => void load())

  return summary
}
