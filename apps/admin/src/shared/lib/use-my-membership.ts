"use client"

import { useEffect, useState } from "react"

import { getMyMembership, type MyMembership } from "../api/members"

// Module-level cache so navigating between admin pages doesn't fire
// the same `/members/me` call repeatedly. Keyed by workspaceId because
// a user can belong to several clubs with different roles.
const cache = new Map<string, MyMembership>()
const inflight = new Map<string, Promise<MyMembership>>()

export const useMyMembership = (
  workspaceId: string | undefined,
): MyMembership | null => {
  const [data, setData] = useState<MyMembership | null>(() => {
    if (!workspaceId) return null
    return cache.get(workspaceId) ?? null
  })

  useEffect(() => {
    if (!workspaceId) return
    const cached = cache.get(workspaceId)
    if (cached) {
      setData(cached)
      return
    }

    let cancelled = false
    const existing = inflight.get(workspaceId)
    const promise =
      existing ??
      getMyMembership({ workspaceId }).then((m) => {
        cache.set(workspaceId, m)
        inflight.delete(workspaceId)
        return m
      })
    inflight.set(workspaceId, promise)

    void promise
      .then((m) => {
        if (!cancelled) setData(m)
      })
      .catch(() => {
        // Silently swallow — page-level fetches will surface the real
        // error. The hook just leaves data=null which the consumer
        // treats as "not yet loaded" or "no role here".
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  return data
}
