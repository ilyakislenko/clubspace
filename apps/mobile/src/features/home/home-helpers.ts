import type { DropInBooking } from "../../shared/api/drop-ins"
import type { MyGroup } from "../../shared/api/groups"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import {
  upcomingConfirmed,
  viewerRole,
} from "../personal-training/personal-training-helpers"
import {
  listTodaySlots,
  parseHHMM,
  zonedParts,
  zonedWallTimeToDate,
  type NextAcrossGroups,
} from "../schedule/schedule-helpers"

/** First name for the greeting, or null when the member hasn't set one. */
export const greetingName = (
  me: { firstname?: string | null } | null | undefined,
): string | null => me?.firstname?.trim() || null

/**
 * The «nothing to show yet» card: when none of the club's cards can render
 * anything (no groups, attendance, subscription, announcement) and there is nothing to
 * continue watching, Home would otherwise be a bare header.
 */
export const showHomeFallback = (opts: {
  groupsOn: boolean
  attendanceOn: boolean
  subscriptionOn: boolean
  hasRecents: boolean
  hasAnnouncement: boolean
}): boolean =>
  !opts.groupsOn &&
  !opts.attendanceOn &&
  !opts.subscriptionOn &&
  !opts.hasRecents &&
  !opts.hasAnnouncement

export type NextTraining =
  | ({ kind: "group"; startAt: Date } & NextAcrossGroups)
  | { kind: "dropin"; startAt: Date; booking: DropInBooking }
  | { kind: "personal"; startAt: Date; training: PersonalTraining }

/**
 * The soonest of the member's own groups' next class, their guest bookings and
 * their confirmed personal sessions (cancelled and finished ones don't count;
 * the caller passes only the sessions where they are the student). A tie goes
 * to the group, then to the booking.
 */
export const pickNextTraining = (
  groupNext: NextAcrossGroups | null,
  bookings: DropInBooking[],
  now: Date,
  personal: PersonalTraining[] = [],
): NextTraining | null => {
  let best: NextTraining | null = groupNext
    ? { kind: "group", startAt: groupNext.next.startAt, ...groupNext }
    : null
  for (const booking of bookings) {
    if (booking.cancelled || new Date(booking.endAt) <= now) continue
    const startAt = new Date(booking.startAt)
    if (!best || startAt < best.startAt) {
      best = { kind: "dropin", startAt, booking }
    }
  }
  for (const training of upcomingConfirmed(personal, now)) {
    const startAt = new Date(training.confirmedStartAt!)
    if (!best || startAt < best.startAt) {
      best = { kind: "personal", startAt, training }
    }
  }
  return best
}

// Workspace roles that run classes. A plain «user» member only trains.
const COACH_ROLE_NAMES = ["coach", "head_coach", "admin"]

/**
 * Whether Home shows the coach view (today's own classes to mark) instead of
 * the student's self check-in: a coaching role in the club, or a coach of any
 * group.
 */
export const isCoachView = (
  roleName: string | null | undefined,
  groups: readonly MyGroup[],
): boolean =>
  (!!roleName && COACH_ROLE_NAMES.includes(roleName)) ||
  groups.some((g) => g.role === "coach")

/**
 * Whether Home keeps the student «Отметиться на тренировке» button. Anyone who
 * trains in a group keeps it — a coach who also trains sees both it and the
 * coach card. It is hidden only for a coach view that has nothing to train
 * in: staff with no groups at all still get it (the server lets any active
 * member check in).
 */
export const showCheckInButton = (
  roleName: string | null | undefined,
  groups: readonly MyGroup[],
): boolean =>
  groups.some((g) => g.role === "student") ||
  groups.length === 0 ||
  !isCoachView(roleName, groups)

export type CoachClassToday = {
  key: string
  // A group class: the group's name. A personal session: «Персональная · …».
  groupName: string
  gymName: string | null
  // A group class is marked by slot + calendar day; a personal session has its
  // own session id instead (the other pair is null).
  slotId: string | null
  // The group's calendar day, as SessionAttendance expects it.
  sessionDate: string | null
  sessionId: string | null
  startTime: string
}

const pad2 = (n: number): string => String(n).padStart(2, "0")

// The viewer's confirmed personal sessions as the coach that fall on today's
// calendar day in the session's own zone (held ones included, like a group
// class that has already started).
const pickCoachPersonalToday = (
  personal: readonly PersonalTraining[],
  meId: string,
  now: Date,
): Array<{ at: Date; item: CoachClassToday }> =>
  personal.flatMap((pt) => {
    if (
      pt.status !== "CONFIRMED" ||
      !pt.confirmedStartAt ||
      !pt.sessionId ||
      viewerRole(pt, meId) !== "coach"
    ) {
      return []
    }
    const at = new Date(pt.confirmedStartAt)
    const today = zonedParts(now, pt.timezone)
    const day = zonedParts(at, pt.timezone)
    if (
      day.year !== today.year ||
      day.month !== today.month ||
      day.day !== today.day
    ) {
      return []
    }
    return [
      {
        at,
        item: {
          key: `personal:${pt.id}`,
          groupName: `Персональная · ${pt.member.displayName}`,
          gymName: pt.gym?.name ?? null,
          slotId: null,
          sessionDate: null,
          sessionId: pt.sessionId,
          startTime: `${pad2(day.hour)}:${pad2(day.minute)}`,
        },
      },
    ]
  })

/**
 * The classes today's timetable gives the groups this user coaches (cancelled
 * ones dropped), plus their confirmed personal sessions as the coach, earliest
 * first. «Today» is each group's (or session's) own zone's day.
 */
export const pickCoachClassesToday = (
  groups: readonly MyGroup[],
  now: Date,
  personal: readonly PersonalTraining[] = [],
  meId: string | null = null,
): CoachClassToday[] =>
  [
    ...groups
      .filter((g) => g.role === "coach")
      .flatMap((g) => {
        const { slots, dateStr } = listTodaySlots(
          g.slots,
          g.exceptions,
          now,
          g.timezone,
        )
        const [year, month, day] = dateStr.split("-").map(Number)
        return slots.map((slot) => {
          const { hour, minute } = parseHHMM(slot.startTime)
          return {
            at: zonedWallTimeToDate(year!, month!, day!, hour, minute, g.timezone),
            item: {
              key: `${slot.id}:${dateStr}`,
              groupName: g.name,
              gymName: g.gym?.name ?? null,
              slotId: slot.id,
              sessionDate: dateStr,
              sessionId: null,
              startTime: slot.startTime,
            },
          }
        })
      }),
    ...(meId ? pickCoachPersonalToday(personal, meId, now) : []),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((x) => x.item)

