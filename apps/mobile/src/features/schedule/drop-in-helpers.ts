import type { ScheduleSession } from "../../shared/api/groups"

export type RsvpState =
  | "hidden"
  | "own_group"
  | "cancelled"
  | "started"
  | "booked"
  | "can_book"
  | "blocked"

// What a member can do with one class of the club schedule. The order matters:
// a booked class stays visible (and cancellable) even if the club later turns
// guest visits off, but never offers a booking the member can't make.
export const rsvpStateFor = (
  s: ScheduleSession,
  c: {
    featureOn: boolean
    isOwner: boolean
    memberGroupIds: ReadonlySet<string>
    coachGroupIds: ReadonlySet<string>
    bookedOccurrenceIds: ReadonlySet<string>
    canBook: boolean
    now: number
  },
): RsvpState => {
  if (s.cancelled) return "cancelled"
  const started = new Date(s.startAt).getTime() <= c.now
  if (c.bookedOccurrenceIds.has(s.occurrenceId)) {
    return started ? "started" : "booked"
  }
  if (!c.featureOn || c.isOwner) return "hidden"
  if (c.memberGroupIds.has(s.groupId) || c.coachGroupIds.has(s.groupId)) {
    return "own_group"
  }
  if (started) return "started"
  return c.canBook ? "can_book" : "blocked"
}
