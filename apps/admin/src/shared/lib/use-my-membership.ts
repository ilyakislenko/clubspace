"use client"

import { useEffect, useState } from "react"

import { getMyMembership, type MyMembership } from "../api/members"
import { cachedRead, peekCachedRead } from "../api/read-cache"

// Kept so navigating between admin pages doesn't refire the same
// `/members/me` call on every mount. Keyed by workspaceId because a user can
// belong to several clubs with different roles; expires after TTL_MS so a
// role/access change is picked up within the session instead of being pinned
// until a full page reload. A new session drops it (read-cache).
const TTL_MS = 60_000

const cacheKey = (workspaceId: string): string => `membership:${workspaceId}`

export const useMyMembership = (
  workspaceId: string | undefined,
): MyMembership | null => useMyMembershipState(workspaceId).membership

// Same lookup, but also reports a failed `/members/me` and lets the caller
// retry — for gates that must not sit blank forever on a transient error.
export const useMyMembershipState = (
  workspaceId: string | undefined,
): { membership: MyMembership | null; failed: boolean; retry: () => void } => {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [data, setData] = useState<MyMembership | null>(() =>
    workspaceId ? (peekCachedRead<MyMembership>(cacheKey(workspaceId)) ?? null) : null,
  )

  useEffect(() => {
    if (!workspaceId) return
    setFailed(false)
    let cancelled = false
    cachedRead(cacheKey(workspaceId), () => getMyMembership({ workspaceId }), TTL_MS)
      .then((m) => {
        if (!cancelled) setData(m)
      })
      .catch(() => {
        // Page-level fetches surface the real error. data stays null, which
        // plain consumers treat as "not loaded yet" or "no role here"; gates
        // read `failed` to offer a retry (a failure is never kept).
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, attempt])

  return {
    membership: data,
    failed,
    retry: () => setAttempt((n) => n + 1),
  }
}
