import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { getApiClient } from "../../shared/api/client"
import { supportsPushNotifications } from "../../shared/platform"

let registrationInFlight = false

const setupAndroidChannel = async () => {
  if (Platform.OS !== "android") return
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  } catch {
    /* noop */
  }
}

const acquireExpoPushToken = async (): Promise<string | null> => {
  // A browser would otherwise be asked for notification permission on sign-in —
  // a prompt nothing can deliver on, since there's no web-push wiring behind it.
  if (!supportsPushNotifications) return null
  if (!Device.isDevice) return null
  try {
    const status = await Notifications.getPermissionsAsync()
    let granted = status.granted
    if (!granted) {
      const next = await Notifications.requestPermissionsAsync()
      granted = next.granted
    }
    if (!granted) return null

    await setupAndroidChannel()

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    )
    return tokenResponse.data
  } catch {
    return null
  }
}

/**
 * Best-effort push token registration. Quietly no-ops on simulators, when the
 * user denies permission, when expo-notifications is unavailable, or when the
 * server rejects the call. Triggered on sign-in and after a workspace switch.
 */
export const registerPushToken = async () => {
  if (registrationInFlight) return
  registrationInFlight = true
  try {
    const token = await acquireExpoPushToken()
    if (!token) return

    const timezone =
      Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"

    try {
      await getApiClient().request<
        { status: "registered" },
        { token: string; timezone: string }
      >({
        method: "post",
        url: "/me/firebase-devices",
        data: { token, timezone },
      })
    } catch {
      /* server will retry on next sign-in */
    }
  } finally {
    registrationInFlight = false
  }
}

export const unregisterPushToken = async () => {
  try {
    const token = await acquireExpoPushToken()
    if (!token) return
    await getApiClient().request<{ status: "removed" }, { token: string }>({
      method: "delete",
      url: "/me/firebase-devices",
      data: { token },
    })
  } catch {
    /* noop */
  }
}
