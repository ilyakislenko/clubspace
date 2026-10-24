import { MEMBER_SECTIONS } from "../../app/nav-sections"
import type { RootStackParamList } from "../../app/navigation"
import type { AppFeatureKey } from "../../shared/feature-flags"

export type NotificationRoute = {
  name: keyof RootStackParamList
  params?: object
}

// The club's weekly schedule. When it moves into a tab, this is the only line
// that changes.
const SCHEDULE_ROUTE: keyof RootStackParamList = "ClubSchedule"

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null

// A section's feature flag lives in MEMBER_SECTIONS (the same list the Profile
// screen and sidebar hide sections by). MyRanks is reached from the Profile
// ranks card rather than that list, so its flag is named here; a route in
// neither place is ungated.
const UNLISTED_FEATURES: Partial<
  Record<keyof RootStackParamList, AppFeatureKey>
> = { MyRanks: "ranks" }

const featureOf = (name: keyof RootStackParamList): AppFeatureKey | undefined =>
  MEMBER_SECTIONS.find((s) => s.route === name)?.feature ??
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

  const gated = (name: keyof RootStackParamList): NotificationRoute | null => {
    const feature = featureOf(name)
    return feature && !isFeatureOn(feature) ? null : { name }
  }
  const schedule = (): NotificationRoute | null =>
    isFeatureOn("schedule") ? gated(SCHEDULE_ROUTE) : gated("MyGroups")

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
      return gated("MySubscription")
    case "session.reminder":
    case "exception.notify":
      return schedule()
    case "event.reminder":
      return gated("Events")
  }

  // Older rows and unknown kinds: a video id alone is still enough to open it.
  return videoId ? { name: "Video", params: { videoId } } : null
}
