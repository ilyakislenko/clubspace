import { isInvitationNotification } from "./notification-route"

/**
 * Holds a tapped push until it can be acted on. A cold start delivers the tap
 * before the navigation container is mounted (splash) and before a workspace is
 * active, so routing it right away would silently drop it. `take` hands the
 * payload out exactly once, and only when routing is possible — a boolean, or
 * a check of the held payload.
 */
export type PendingPush = {
  hold: (data: unknown) => void
  take: (canRoute: boolean | ((data: unknown) => boolean)) => { data: unknown } | null
}

export const createPendingPush = (): PendingPush => {
  let held: { data: unknown } | null = null
  return {
    hold: (data) => {
      held = { data }
    },
    take: (canRoute) => {
      if (!held) return null
      const ok = typeof canRoute === "function" ? canRoute(held.data) : canRoute
      if (!ok) return null
      const out = held
      held = null
      return out
    },
  }
}

/**
 * Whether a held tap can be routed now. Club screens need an active, unlocked
 * club (feature flags are judged against it). A club invitation only needs a
 * signed-in member past the lock screen: an invited account may have no club.
 */
export const canRoutePush = (
  data: unknown,
  state: {
    navReady: boolean
    signedIn: boolean
    workspace: { accessExpired: boolean } | null
  },
): boolean => {
  if (!state.navReady || state.workspace?.accessExpired) return false
  return isInvitationNotification(data) ? state.signedIn : state.workspace !== null
}
