"use client"

import { useEffect, useState } from "react"

import { getMyMembership, type MyMembership } from "../api/members"

// Module-level cache so navigating between admin pages doesn't refire the
// same `/members/me` call on every mount. Keyed by workspaceId because a
// user can belong to several clubs with different roles. Entries carry a
// timestamp and expire after TTL_MS so a role/access change is picked up
// within the session instead of being pinned until a full page reload.
const TTL_MS = 60_000

type CacheEntry = { value: MyMembership; storedAt: number }

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<MyMembership>>()

const readFresh = (workspaceId: string): MyMembership | null => {
  const entry = cache.get(workspaceId)
  if (!entry) return null
  if (Date.now() - entry.storedAt > TTL_MS) {
    cache.delete(workspaceId)
    return null
  }
  return entry.value
}

export const useMyMembership = (
  workspaceId: string | undefined,
): MyMembership | null => {
  const [data, setData] = useState<MyMembership | null>(() =>
    workspaceId ? readFresh(workspaceId) : null,
  )

  useEffect(() => {
    if (!workspaceId) return
    const cached = readFresh(workspaceId)
    if (cached) {
      setData(cached)
      return
    }

    let cancelled = false
    const existing = inflight.get(workspaceId)
    const promise =
      existing ??
      getMyMembership({ workspaceId }).then((m) => {
        cache.set(workspaceId, { value: m, storedAt: Date.now() })
        return m
      })
    inflight.set(workspaceId, promise)

    void promise
      .then((m) => {
        if (!cancelled) setData(m)
      })
      .catch(() => {
        // Silently swallow — page-level fetches surface the real error.
        // data stays null, which the consumer treats as "not loaded yet"
        // or "no role here".
      })
      .finally(() => {
        // Clear the in-flight slot whichever way it settled, so a transient
        // failure doesn't pin a rejected promise here and permanently wedge
        // the hook at data=null for this workspace. Guard against clobbering
        // a newer request that may have replaced this one.
        if (inflight.get(workspaceId) === promise) {
          inflight.delete(workspaceId)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return data
}
