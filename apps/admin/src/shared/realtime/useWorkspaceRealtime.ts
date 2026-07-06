"use client"

import { useEffect, useRef } from "react"

import { subscribeRealtime } from "./realtime"

/**
 * Call `onInvalidate` whenever the realtime gateway pushes an invalidation for
 * one of `resources` in this workspace — so an admin page live-refreshes as
 * members check in, buy abonements, get promoted, etc. `onInvalidate` is read
 * through a ref, so it can be an inline closure without re-subscribing.
 */
export function useWorkspaceRealtime(
  workspaceId: string | undefined,
  resources: string[],
  onInvalidate: () => void,
) {
  const cbRef = useRef(onInvalidate)
  cbRef.current = onInvalidate
  const resourcesKey = resources.join(",")

  useEffect(() => {
    if (!workspaceId) return
    const wanted = new Set(resourcesKey.split(",").filter(Boolean))
    return subscribeRealtime((wsId, incoming) => {
      if (wsId !== workspaceId) return
      if (incoming.some((r) => wanted.has(r))) cbRef.current()
    })
  }, [workspaceId, resourcesKey])
}
