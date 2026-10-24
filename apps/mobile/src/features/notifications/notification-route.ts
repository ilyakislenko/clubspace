import { SIDEBAR_SECTIONS } from "../../app/nav-sections"
import type { RootStackParamList } from "../../app/navigation"
import type { AppFeatureKey } from "../../shared/feature-flags"

export type NotificationRoute = {
  name: keyof RootStackParamList
  params?: object
}

// The untyped shape of `navigate` that route names from push data / inbox
// metadata are passed to.
export type RouteNavigator = {
  navigate: (name: string, params?: object, options?: { pop?: boolean }) => void
}

// The Schedule tab: the club's weekly schedule, or the member's groups when the
// club has the schedule switched off (see scheduleTabContent).
const SCHEDULE_TAB: NotificationRoute = {
  name: "Main",
  params: { screen: "Schedule" },
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

// A section's feature flag lives in SIDEBAR_SECTIONS (the lists the Home,
// Progress and Profile tabs and the sidebar hide sections by). MyRanks is
// reached from the Progress rank card rather than a list, so its flag is named
// here; a route in neither place is ungated.
const UNLISTED_FEATURES: Partial<
  Record<keyof RootStackParamList, AppFeatureKey>
> = { MyRanks: "ranks" }

const featureOf = (name: keyof RootStackParamList): AppFeatureKey | undefined =>
  SIDEBAR_SECTIONS.find((s) => s.route === name)?.feature ??
  UNLISTED_FEATURES[name]

/**
 * Where a notification should take the member, from its saved metadata (the
 * server stamps `kind` plus ids on every row, and push `data` carries the same
 * object). Returns null when there is nothing to open — an unknown kind, a
 * missing id, or a target whose app section the club has switched off — and the
 * caller decides the fallback (push opens the inbox; the inbox does nothing).
 */
export const routeForNotification = (
  metadata: unknown,
  isFeatureOn: (key: AppFeatureKey) => boolean,
): NotificationRoute | null => {
  const m = (metadata ?? {}) as Record<string, unknown>
  const kind = str(m.kind)
  const videoId = str(m.videoId)
  const courseId = str(m.courseId)
  const requestId = str(m.requestId)

  const gated = (name: keyof RootStackParamList): NotificationRoute | null => {
    const feature = featureOf(name)
    return feature && !isFeatureOn(feature) ? null : { name }
  }
  // The tab is there while either the schedule or the groups are on.
  const schedule = (): NotificationRoute | null =>
    isFeatureOn("schedule") || isFeatureOn("groups") ? SCHEDULE_TAB : null

  switch (kind) {
    case "video.published":
    case "video.ready":
      return videoId ? { name: "Video", params: { videoId } } : null
    case "course.published":
      return courseId
        ? {
            name: "CourseDetail",
            params: { courseId, title: str(m.title) ?? undefined },
          }
        : null
    case "rank.promoted":
      return gated("MyRanks")
    case "achievement.unlocked":
      return gated("Achievements")
    case "announcement.published":
      return gated("Announcements")
    case "member.inactive":
      return gated("MyAttendance")
    case "classes.low":
    case "classes.exhausted":
    case "access.expiring":
    case "subscription.first_visit_pending":
      return gated("MySubscription")
    case "session.reminder":
    case "exception.notify":
    // A guest booked / cancelled. Deliberately the Schedule tab, not the
    // roster: opening the roster would create a far-future session.
    case "dropin.booked":
    case "dropin.cancelled":
      return schedule()
    case "personal.requested":
    case "personal.proposed":
    case "personal.confirmed":
    case "personal.declined":
    case "personal.cancelled":
      return requestId
        ? { name: "PersonalTraining", params: { requestId } }
        : { name: "PersonalTrainings" }
    case "event.reminder":
      return gated("Events")
  }

  // Older rows and unknown kinds: a video id alone is still enough to open it.
  return videoId ? { name: "Video", params: { videoId } } : null
}

/**
 * Opens a route from `routeForNotification`. A tab is reached through `Main`,
 * and `pop` returns to the tab bar already on the stack instead of pushing a
 * second one.
 */
export const openNotificationRoute = (
  nav: RouteNavigator,
  route: NotificationRoute,
) => {
  nav.navigate(
    route.name,
    route.params,
    route.name === "Main" ? { pop: true } : undefined,
  )
}
