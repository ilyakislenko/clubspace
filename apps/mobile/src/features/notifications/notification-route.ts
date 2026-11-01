import { SIDEBAR_SECTIONS } from "../../app/nav-sections"
import type { RootStackParamList } from "../../app/navigation"
import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { isFeatureEnabled, type AppFeatureKey } from "../../shared/feature-flags"

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
// reached from the Progress rank card and MyClassBookings from the schedule
// rather than a list, so their flags are named here; a route in neither place
// is ungated.
const UNLISTED_FEATURES: Partial<
  Record<keyof RootStackParamList, AppFeatureKey>
> = { MyRanks: "ranks", MyClassBookings: "schedule" }

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
    case "grading.moved":
    case "grading.cancelled":
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
    // A waitlist promotion, a place booked by staff, a class cancelled by the
    // club, a no-show: the member's «Мои записи».
    case "classbooking.promoted":
    case "classbooking.added":
    case "classbooking.club_cancelled":
    case "classbooking.noshow":
      return gated("MyClassBookings")
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
    // An offer from a club the member is not in yet: answered on the
    // Invitations screen.
    case "member.invitation":
      return { name: "Invitations" }
    // A club added a child and named this guardian: confirm it on «Дети».
    // Always opened as the guardian (see profileForNotification).
    case "guardian.invite":
      return { name: "Children" }
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

/**
 * The club a notification belongs to when it is not the active one: its
 * `metadata.workspaceId` names a club in the member's list that differs from
 * the active club. Null when there is nothing to switch (no id, same club, or
 * a club the member can't be switched into — see `isUnreachableClub`).
 * A club whose access has lapsed is never switched to: it would be saved as the
 * active one and lock the member out on this and the next launch.
 */
export const clubToSwitchTo = (
  metadata: unknown,
  active: WorkspaceSummary | null,
  workspaces: WorkspaceSummary[],
): WorkspaceSummary | null => {
  const id = str((metadata as Record<string, unknown> | null)?.workspaceId)
  if (!id || id === active?.workspaceId) return null
  const club = workspaces.find((w) => w.workspaceId === id)
  return club && !club.accessExpired ? club : null
}

// The notification names another club the member can't be taken to (not in
// their list, or its access has lapsed): there is no route, the inbox row is
// the notice.
const isUnreachableClub = (
  metadata: unknown,
  active: WorkspaceSummary | null,
  workspaces: WorkspaceSummary[],
): boolean => {
  const id = str((metadata as Record<string, unknown> | null)?.workspaceId)
  return (
    !!id &&
    id !== active?.workspaceId &&
    clubToSwitchTo(metadata, active, workspaces) === null
  )
}

/**
 * Which profile a notification has to be opened as. A child's notifications
 * reach the guardian's inbox with `metadata.dependentId`; everything else —
 * and a club's invitation to confirm a child, which names a child that is not
 * confirmed yet — belongs to the guardian. `unavailable`: the child is not one
 * the guardian may act for (not confirmed, or no longer theirs).
 */
export type ProfileTarget =
  | { kind: "stay" }
  | { kind: "switch"; dependentId: string | null }
  | { kind: "unavailable" }

export type ProfileContext = {
  /** The child acted for now; null = the guardian. */
  actingAsId: string | null
  /** Confirmed children the guardian may switch to. */
  switchableIds: readonly string[]
}

export const profileForNotification = (
  metadata: unknown,
  ctx: ProfileContext,
): ProfileTarget => {
  const m = (metadata ?? {}) as Record<string, unknown>
  const owner = str(m.kind) === "guardian.invite" ? null : str(m.dependentId)
  if (owner === ctx.actingAsId) return { kind: "stay" }
  if (owner === null || ctx.switchableIds.includes(owner)) {
    return { kind: "switch", dependentId: owner }
  }
  return { kind: "unavailable" }
}

export type NotificationContext = ProfileContext & {
  workspace: WorkspaceSummary | null
  workspaces: WorkspaceSummary[]
  switchWorkspace: (workspaceId: string) => void
  /**
   * Switches to the notification's profile, then opens it again from that
   * profile's clubs (asynchronous: the profile's clubs load first).
   */
  switchProfileThenOpen: (dependentId: string | null, metadata: unknown) => void
}

export type ResolvedNotification =
  | { kind: "open"; route: NotificationRoute; target: WorkspaceSummary | null }
  | { kind: "switch-profile"; dependentId: string | null }

/**
 * A club invitation: its `workspaceId` names a club the member has NOT joined,
 * so it must neither switch clubs nor be dropped as unreachable — and it opens
 * even with no club at all (the Invitations screen is on the onboarding stack).
 */
export const isInvitationNotification = (metadata: unknown): boolean =>
  str((metadata as Record<string, unknown> | null)?.kind) === "member.invitation"

/**
 * Where a notification leads from the member's current state: another profile
 * to switch to first (its route is resolved once that profile's clubs are
 * loaded), or its route plus the club to switch to first (feature flags are
 * judged against that club). Null when there is nothing to open.
 */
export const resolveNotification = (
  metadata: unknown,
  ctx: Pick<
    NotificationContext,
    "workspace" | "workspaces" | "actingAsId" | "switchableIds"
  >,
): ResolvedNotification | null => {
  const profile = profileForNotification(metadata, ctx)
  if (profile.kind === "unavailable") return null
  if (profile.kind === "switch") {
    // Nothing to open in any club: no reason to leave the current profile.
    return routeForNotification(metadata, () => true)
      ? { kind: "switch-profile", dependentId: profile.dependentId }
      : null
  }
  if (isInvitationNotification(metadata)) {
    return { kind: "open", route: { name: "Invitations" }, target: null }
  }
  if (isUnreachableClub(metadata, ctx.workspace, ctx.workspaces)) return null
  const target = clubToSwitchTo(metadata, ctx.workspace, ctx.workspaces)
  const route = routeForNotification(metadata, (key) =>
    isFeatureEnabled(target ?? ctx.workspace, key),
  )
  return route ? { kind: "open", route, target } : null
}

/**
 * Opens a notification from a push tap or an inbox row: switches to the
 * profile and the club it belongs to first, then navigates. Returns false when
 * there is no route to open.
 */
export const openNotification = (
  nav: RouteNavigator,
  metadata: unknown,
  ctx: NotificationContext,
): boolean => {
  const resolved = resolveNotification(metadata, ctx)
  if (!resolved) return false
  if (resolved.kind === "switch-profile") {
    ctx.switchProfileThenOpen(resolved.dependentId, metadata)
    return true
  }
  if (resolved.target) ctx.switchWorkspace(resolved.target.workspaceId)
  openNotificationRoute(nav, resolved.route)
  return true
}
