import { useCallback, useMemo } from "react"

import { listDirections, type Direction } from "../../shared/api/directions"
import { useCachedResource } from "../../shared/cache/useCachedResource"

/**
 * The club's active directions. Best-effort: a failed or pending load reads
 * as "no directions", so every direction selector just stays hidden and the
 * screen looks as it did before directions existed.
 */
export function useDirections(workspaceId: string | null | undefined): Direction[] {
  const { data } = useCachedResource<Direction[]>(
    workspaceId ? `directions:${workspaceId}` : null,
    useCallback(
      async () => await listDirections({ workspaceId: workspaceId! }),
      [workspaceId],
    ),
  )
  // Staff also get archived ones; selectors only ever offer active ones.
  return useMemo(() => (data ?? []).filter((d) => d.isActive), [data])
}
