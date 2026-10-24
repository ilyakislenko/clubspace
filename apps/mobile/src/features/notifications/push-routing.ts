import * as Notifications from "expo-notifications"
import { useEffect } from "react"

import { navigationRef } from "../../app/navigation"
import { isFeatureEnabled } from "../../shared/feature-flags"
import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { supportsPushNotifications } from "../../shared/platform"
import {
  openNotificationRoute,
  routeForNotification,
  type RouteNavigator,
} from "./notification-route"
import { createPendingPush } from "./push-pending"

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

// Server push payloads carry the notification's metadata in `data` (see
// PushDeliveryService, which spreads the row's metadata — including `kind` —
// into the Expo message data). The shared routeForNotification picks the
// screen; when there's none (unknown kind, section switched off) we open the
// inbox where every notification lives.
const pending = createPendingPush()
let activeWorkspace: WorkspaceSummary | null = null

/**
 * Routes a held push tap once the navigation container is mounted AND a
 * workspace is active (feature flags need it). Cold starts deliver the tap
 * while the splash is up, so this is also called from the container's onReady.
 */
export const flushPendingPush = () => {
  const workspace = activeWorkspace
  const held = pending.take(
    navigationRef.isReady() && !!workspace && !workspace.accessExpired,
  )
  if (!held) return
  const route = routeForNotification(held.data, (key) =>
    isFeatureEnabled(workspace, key),
  )
  const nav = navigationRef as RouteNavigator
  if (route) openNotificationRoute(nav, route)
  else nav.navigate("Notifications")
}

/**
 * Routes the app when the user taps a push notification — whether the app was
 * backgrounded (response listener) or launched cold from the tap
 * (getLastNotificationResponseAsync). Only active while signed in, since the
 * target screens don't exist on the auth stack.
 */
export function usePushNotificationRouting(
  enabled: boolean,
  workspace: WorkspaceSummary | null,
) {
  useEffect(() => {
    activeWorkspace = workspace
    flushPendingPush()
  }, [workspace])

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
