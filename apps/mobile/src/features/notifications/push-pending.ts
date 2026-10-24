/**
 * Holds a tapped push until it can be acted on. A cold start delivers the tap
 * before the navigation container is mounted (splash) and before a workspace is
 * active, so routing it right away would silently drop it. `take` hands the
 * payload out exactly once, and only when both conditions hold.
 */
export type PendingPush = {
  hold: (data: unknown) => void
  take: (canRoute: boolean) => { data: unknown } | null
}

export const createPendingPush = (): PendingPush => {
  let held: { data: unknown } | null = null
  return {
    hold: (data) => {
      held = { data }
    },
    take: (canRoute) => {
      if (!canRoute || !held) return null
      const out = held
      held = null
      return out
    },
  }
}
