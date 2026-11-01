"use client"

import { useCallback, useEffect, useState } from "react"

import { listDirections, type Direction } from "../../shared/api/directions"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"

/**
 * The club's directions (staff see archived ones too), live-refreshed on the
 * `directions` realtime resource. A failed load degrades to `[]` — every
 * direction control hides itself then, i.e. the page looks as it did before
 * directions existed.
 */
export function useDirections(workspaceId: string | undefined) {
  const [directions, setDirections] = useState<Direction[]>([])

  const reload = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listDirections({ workspaceId })
      setDirections(res.data)
    } catch {
      setDirections([])
    }
  }, [workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  useWorkspaceRealtime(workspaceId, ["directions"], () => void reload())

  return { directions, reload }
}
