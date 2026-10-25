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
      return videoId && isFeatureOn("videos")
        ? { name: "Video", params: { videoId } }
        : null
    case "course.published":
      return courseId && isFeatureOn("videos")
        ? {
            name: "CourseDetail",
            params: { courseId, title: str(m.title) ?? undefined },
          }
        : null
    case "rank.promoted":
    case "grading.candidate":
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
    case "subscription.payment_due":
    case "freeze.approved":
    case "freeze.declined":
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
    // Staff: a member asked to freeze their abonement; the decision lives on
    // that member's abonement screen. (`freezeRequestId`, not `requestId`: the
    // latter is already read for personal.*.)
    case "freeze.requested":
      return str(m.memberUserId)
        ? { name: "MemberSubscription", params: { userId: str(m.memberUserId) } }
        : null
    case "event.reminder":
      return gated("Events")
    // Staff only; the screen checks the role itself, so the route is ungated.
    case "retention.digest":
      return { name: "AtRiskMembers" }
    // Applicant: the club accepted the request and is now in the app.
    case "member.approved":
      return { name: "Main", params: { screen: "Home" } }
    // Staff: a new join request opens the invite screen, where it is listed.
    // An auto-approved join (member.joined) has nothing to decide, so the inbox
    // row itself is the notice.
    case "member.join_requested":
      return str(m.workspaceId)
        ? { name: "ClubInvite", params: { workspaceId: str(m.workspaceId) } }
        : { name: "ClubInvite" }
    case "member.joined":
      return null
  }

  // Older rows and unknown kinds: a video id alone is still enough to open it.
  return videoId && isFeatureOn("videos")
    ? { name: "Video", params: { videoId } }
    : null
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
