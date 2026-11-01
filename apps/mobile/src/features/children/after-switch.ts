import { navigationRef } from "../../app/navigation"
import type { RouteNavigator } from "../notifications/notification-route"

// A profile switch drops every screen of the previous profile (App.tsx keys
// the stack by profile), so a screen to open "after switching" can't be
// navigated to right away: it is held here and opened once the new profile's
// stack is rendered (App.tsx calls flushAfterSwitch on every profile change).

/** Screens opened right after a switch; both exist with and without a club. */
export type AfterSwitchRoute = "JoinClub" | "Children"

let held: { profileId: string | null; route: AfterSwitchRoute } | null = null

export const openAfterSwitch = (
  profileId: string | null,
  route: AfterSwitchRoute,
) => {
  held = { profileId, route }
}

export const dropAfterSwitch = () => {
  held = null
}

/** Navigates by a name held as data (the typed overloads want a literal). */
export const navigateTo = (route: AfterSwitchRoute) => {
  if (navigationRef.isReady()) (navigationRef as RouteNavigator).navigate(route)
}

/**
 * Opens the held screen if it was meant for `profileId`. Deferred a tick: the
 * stack applies the profile's new key in a scheduled update of its own, and a
 * navigate before it would be dropped with the old screens.
 */
export const flushAfterSwitch = (profileId: string | null) => {
  if (!held || held.profileId !== profileId) return
  const { route } = held
  held = null
  setTimeout(() => navigateTo(route), 0)
}
