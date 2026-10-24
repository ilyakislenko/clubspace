import type { DropInBooking } from "../../shared/api/drop-ins"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import { upcomingConfirmed } from "../personal-training/personal-training-helpers"
import type { NextAcrossGroups } from "../schedule/schedule-helpers"

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
