import Constants from "expo-constants"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { getApiClient } from "../../shared/api/client"
import { kvGet, kvSet } from "../../shared/kv"
import { supportsPushNotifications } from "../../shared/platform"

let registrationInFlight = false

// The OS prompt is asked for at most once per install, and only once the member
// is inside a club — not on the sign-in/pending screens, and not on every
// foreground. After that the app only ever checks the permission.
const PERMISSION_ASKED_KEY = "clubspace.pushPermissionAsked"

const wasPermissionAsked = async (): Promise<boolean> =>
  Boolean(await kvGet(PERMISSION_ASKED_KEY).catch(() => null))

const setupAndroidChannel = async () => {
  if (Platform.OS !== "android") return
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Уведомления клуба",
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  } catch {
    /* noop */
  }
}

const acquireExpoPushToken = async (
  requestPermission: boolean,
): Promise<string | null> => {
  // A browser would otherwise be asked for notification permission on sign-in —
  // a prompt nothing can deliver on, since there's no web-push wiring behind it.
  if (!supportsPushNotifications) return null
  if (!Device.isDevice) return null
  try {
    // Android 13+ shows no permission prompt until a channel exists, so the
    // channel must be created before the permission is requested.
    await setupAndroidChannel()

    const status = await Notifications.getPermissionsAsync()
    let granted = status.granted
    if (!granted && requestPermission && !(await wasPermissionAsked())) {
      const next = await Notifications.requestPermissionsAsync()
      granted = next.granted
      // Only a prompt that actually resolved counts: one that threw or was
      // dismissed by the system must be allowed to show again.
      await kvSet(PERMISSION_ASKED_KEY, "1").catch(() => undefined)
    }
    if (!granted) return null

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
 * Best-effort push token registration. Only asks the OS for permission when
 * `requestPermission` is set (and never more than once); otherwise it registers
 * only if permission is already granted. Quietly no-ops on simulators, when the
 * user denies permission, when expo-notifications is unavailable, or when the
 * server rejects the call. Triggered on sign-in and after a workspace switch.
 */
export const registerPushToken = async ({
  requestPermission = false,
}: { requestPermission?: boolean } = {}) => {
  if (registrationInFlight) return
  registrationInFlight = true
  try {
    const token = await acquireExpoPushToken(requestPermission)
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
    const token = await acquireExpoPushToken(false)
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
