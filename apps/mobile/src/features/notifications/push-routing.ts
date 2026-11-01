import * as Notifications from "expo-notifications"
import { useEffect } from "react"

import { navigationRef } from "../../app/navigation"
import type { ActingAs } from "../../shared/acting-as"
import type { MyDependent } from "../../shared/api/dependents"
import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { isWeb, supportsPushNotifications } from "../../shared/platform"
import { switchableDependents } from "../children/children-helpers"
import {
  openNotification,
  profileForNotification,
  routeForNotification,
  type RouteNavigator,
} from "./notification-route"
import { canRoutePush, createPendingPush } from "./push-pending"
import { takeWebPushLaunchData, WEB_PUSH_CLICK_MESSAGE } from "./web-push-click"

// Foreground notifications are silent by default — show them as a banner so a
// push that lands while the app is open is still visible.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export type PushRoutingState = {
  workspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  switchWorkspace: (workspaceId: string) => void
  actingAs: ActingAs | null
  dependents: MyDependent[]
  switchProfile: (dependentId: string | null) => Promise<void>
}

// Server push payloads carry the notification's metadata in `data` (see
// PushDeliveryService, which spreads the row's metadata — including `kind` —
// into the Expo message data). The shared routeForNotification picks the
// screen; when there's none (unknown kind, section switched off) we open the
// inbox where every notification lives.
const pending = createPendingPush()
let signedIn = false
let state: PushRoutingState = {
  workspace: null,
  workspaces: [],
  switchWorkspace: () => undefined,
  actingAs: null,
  dependents: [],
  switchProfile: async () => undefined,
}

/**
 * Switches to the profile a notification belongs to, then opens it once that
 * profile's clubs are in: the payload is held again, and the state change the
 * switch causes flushes it (usePushNotificationRouting). A failed switch drops
 * it — the inbox still has the row.
 */
export const switchProfileThenOpen = (
  dependentId: string | null,
  data: unknown,
) => {
  pending.hold(data)
  void state.switchProfile(dependentId).catch(() => {
    pending.take(true)
  })
}

const profileContext = () => ({
  actingAsId: state.actingAs?.id ?? null,
  switchableIds: switchableDependents(state.dependents).map((d) => d.id),
})

// Routable while the current profile has no club: «Дети» (a club's invitation
// to confirm a child) exists on the onboarding stack too, and a notification
// of another profile is first switched to — that profile has its own clubs.
const routableWithoutClub = (data: unknown) =>
  routeForNotification(data, () => true)?.name === "Children" ||
  profileForNotification(data, profileContext()).kind === "switch"

/**
 * Routes a held push tap once the navigation container is mounted AND a
 * workspace is active (feature flags need it) — or, for a club invitation,
 * once signed in (see canRoutePush). Cold starts deliver the tap while the
 * splash is up, so this is also called from the container's onReady.
 */
export const flushPendingPush = () => {
  const { workspace } = state
  const held = pending.take(
    (data) =>
      canRoutePush(data, {
        navReady: navigationRef.isReady(),
        signedIn,
        workspace,
      }) ||
      (navigationRef.isReady() &&
        signedIn &&
        workspace === null &&
        routableWithoutClub(data)),
  )
  if (!held) return
  const nav = navigationRef as RouteNavigator
  const opened = openNotification(nav, held.data, {
    ...profileContext(),
    workspace,
    workspaces: state.workspaces,
    switchWorkspace: state.switchWorkspace,
    switchProfileThenOpen,
  })
  if (!opened && workspace) nav.navigate("Notifications")
}

/**
 * Routes the app when the user taps a push notification — whether the app was
 * backgrounded (response listener) or launched cold from the tap
 * (getLastNotificationResponseAsync). Only active while signed in, since the
 * target screens don't exist on the auth stack.
 */
export function usePushNotificationRouting(
  enabled: boolean,
  next: PushRoutingState,
) {
  const {
    workspace,
    workspaces,
    switchWorkspace,
    actingAs,
    dependents,
    switchProfile,
  } = next
  useEffect(() => {
    signedIn = enabled
    state = {
      workspace,
      workspaces,
      switchWorkspace,
      actingAs,
      dependents,
      switchProfile,
    }
    // Deferred a tick: after a profile switch the stack drops the previous
    // profile's screens in a scheduled update, which would swallow a navigate
    // made before it (see children/after-switch).
    setTimeout(flushPendingPush, 0)
  }, [enabled, workspace, workspaces, switchWorkspace, actingAs, dependents, switchProfile])

  useEffect(() => {
    if (!enabled || !isWeb) return
    // Web Push taps: the service worker opens the app with the payload in the
    // URL when no window was open, or posts it to the open window.
    const launched = takeWebPushLaunchData()
    if (launched !== undefined) {
      pending.hold(launched)
      flushPendingPush()
    }
    if (!("serviceWorker" in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; data?: unknown } | null
      if (msg?.type !== WEB_PUSH_CLICK_MESSAGE) return
      pending.hold(msg.data)
      flushPendingPush()
    }
    navigator.serviceWorker.addEventListener("message", onMessage)
    return () => navigator.serviceWorker.removeEventListener("message", onMessage)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    // On web `getLastNotificationResponseAsync` throws UnavailabilityError, and
    // the rejection surfaced as a console error on every sign-in. There are no
    // notification taps to route in a browser anyway.
    if (!supportsPushNotifications) return
    let handled = false

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && !handled) {
        handled = true
        pending.hold(response.notification.request.content.data)
        flushPendingPush()
      }
    })

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        pending.hold(response.notification.request.content.data)
        flushPendingPush()
      },
    )
    return () => sub.remove()
  }, [enabled])
}
