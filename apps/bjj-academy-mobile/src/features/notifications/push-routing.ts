import * as Notifications from "expo-notifications"
import { useEffect } from "react"

import { navigationRef } from "../../app/navigation"
import { supportsPushNotifications } from "../../shared/platform"

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
// into the Expo message data). We deep-link by kind first, fall back to a
// videoId, and otherwise open the inbox where every notification lives.
const routeFromData = (data: unknown) => {
  if (!navigationRef.isReady()) return
  const record = (data ?? {}) as Record<string, unknown>
  const kind = typeof record.kind === "string" ? record.kind : null
  const videoId =
    typeof record.videoId === "string" ? record.videoId : null
  const courseId =
    typeof record.courseId === "string" ? record.courseId : null
  const courseTitle =
    typeof record.title === "string" ? record.title : undefined

  switch (kind) {
    case "rank.promoted":
      navigationRef.navigate("MyRanks")
      return
    case "achievement.unlocked":
      navigationRef.navigate("Achievements")
      return
    case "announcement.published":
      navigationRef.navigate("Announcements")
      return
    case "member.inactive":
      navigationRef.navigate("MyAttendance")
      return
    case "classes.low":
    case "classes.exhausted":
      navigationRef.navigate("MySubscription")
      return
    case "course.published":
      if (courseId) {
        navigationRef.navigate("CourseDetail", {
          courseId,
          title: courseTitle,
        })
        return
      }
      break
    case "video.published":
      if (videoId) {
        navigationRef.navigate("Video", { videoId })
        return
      }
      break
  }

  if (videoId) {
    navigationRef.navigate("Video", { videoId })
  } else {
    navigationRef.navigate("Notifications")
  }
}

/**
 * Routes the app when the user taps a push notification — whether the app was
 * backgrounded (response listener) or launched cold from the tap
 * (getLastNotificationResponseAsync). Only active while signed in, since the
 * target screens don't exist on the auth stack.
 */
export function usePushNotificationRouting(enabled: boolean) {
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
        routeFromData(response.notification.request.content.data)
      }
    })

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        routeFromData(response.notification.request.content.data)
      },
    )
    return () => sub.remove()
  }, [enabled])
}
