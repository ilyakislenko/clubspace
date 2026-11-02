import type { ClassBooking } from "../../shared/api/class-bookings"
import type { ClassSubstitution } from "../../shared/api/class-substitutions"
import type { DropInBooking } from "../../shared/api/drop-ins"
import type {
  EventRegistrationSummary,
  MyGroup,
  ScheduleEvent,
} from "../../shared/api/groups"
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
import { shortPersonName } from "../schedule/schedule-calendar"

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

/**
 * Whether Home shows the personal «Абонемент» card. Staff (owner, admin,
 * coaches) usually don't train on an abonement, so «Абонемент не оформлен»
 * is noise for them: they see the card only once they have (or had) one in
 * this club. Members always see it.
 */
export const showSubscriptionCard = (
  isStaff: boolean,
  // `abonements` is missing in a cache from before parallel abonements.
  data: { abonements?: readonly unknown[]; history: readonly unknown[] },
): boolean =>
  !isStaff || (data.abonements?.length ?? 0) > 0 || data.history.length > 0

export type NextTraining =
  | ({ kind: "group"; startAt: Date } & NextAcrossGroups)
  | { kind: "dropin"; startAt: Date; booking: DropInBooking }
  | { kind: "classBooking"; startAt: Date; booking: ClassBooking }
  | { kind: "personal"; startAt: Date; training: PersonalTraining }

/**
 * The soonest of the member's own groups' next class, their guest bookings,
 * their places in «Запись на занятие» classes (a held place only: not the
 * waitlist, not a cancelled class) and their confirmed personal sessions
 * (cancelled and finished ones don't count; the caller passes only the
 * sessions where they are the student). A tie goes to the group, then to the
 * booking.
 */
export const pickNextTraining = (
  groupNext: NextAcrossGroups | null,
  bookings: DropInBooking[],
  now: Date,
  personal: PersonalTraining[] = [],
  classBookings: readonly ClassBooking[] = [],
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
  for (const booking of classBookings) {
    if (booking.status !== "BOOKED" || booking.classCancelled) continue
    if (new Date(booking.endAt) <= now) continue
    const startAt = new Date(booking.startAt)
    if (!best || startAt < best.startAt) {
      best = { kind: "classBooking", startAt, booking }
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

export type MyEventRegistration = NonNullable<EventRegistrationSummary["mine"]>
export type MyNextEvent = { event: ScheduleEvent; mine: MyEventRegistration }

/**
 * The soonest event the viewer is signed up for or queued on: finished ones
 * and cancelled registrations don't count, an event under way still does.
 */
export const pickNextEvent = (
  events: readonly ScheduleEvent[],
  now: Date,
): MyNextEvent | null => {
  let best: MyNextEvent | null = null
  for (const event of events) {
    const mine = event.registration?.mine
    if (!mine || mine.status === "CANCELLED") continue
    if (new Date(event.endAt) <= now) continue
    if (!best || new Date(event.startAt) < new Date(best.event.startAt)) {
      best = { event, mine }
    }
  }
  return best
}

// «Вы записаны · оплата в клубе» / «Вы записаны · можно оплатить онлайн» /
// «Оплачено» / «В листе ожидания, 2-я». `onlinePayment`: the club takes this
// ticket online (the card opens the event, where the button is).
export const eventStatusLine = (
  mine: MyEventRegistration,
  price: number | null | undefined,
  onlinePayment = false,
): string => {
  if (mine.status === "WAITLISTED") {
    return mine.waitlistPosition
      ? `В листе ожидания, ${mine.waitlistPosition}-я`
      : "В листе ожидания"
  }
  if (mine.isPaid) return "Оплачено"
  if (!price) return "Вы записаны"
  return onlinePayment
    ? "Вы записаны · можно оплатить онлайн"
    : "Вы записаны · оплата в клубе"
}

// «Сегодня в 19:00» / «Завтра в 19:00» / «14 ноября в 19:00», in the event's
// own zone: a master class can be weeks away, so no bare weekday.
export const formatEventWhen = (
  startAt: Date,
  timeZone: string,
  now: Date,
): string => {
  const p = zonedParts(startAt, timeZone)
  const today = zonedParts(now, timeZone)
  const daysAhead = Math.round(
    (Date.UTC(p.year, p.month - 1, p.day) -
      Date.UTC(today.year, today.month - 1, today.day)) /
      86_400_000,
  )
  const time = `${pad2(p.hour)}:${pad2(p.minute)}`
  if (daysAhead <= 0) return `Сегодня в ${time}`
  if (daysAhead === 1) return `Завтра в ${time}`
  const day = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "numeric",
    month: "long",
  }).format(startAt)
  return `${day} в ${time}`
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
  // «Замена» on a class the viewer runs for another coach; «Замена: И.
  // Фамилия» on their own group's class somebody else runs.
  note?: string
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

// Approved substitutions the viewer runs today (in the class's own zone).
const pickSubstitutionsToday = (
  substitutions: readonly ClassSubstitution[],
  meId: string,
  now: Date,
): Array<{ at: Date; item: CoachClassToday }> =>
  substitutions.flatMap((s) => {
    if (s.status !== "APPROVED" || s.substitute.id !== meId) return []
    const at = new Date(s.startAt)
    const today = zonedParts(now, s.timezone)
    const day = zonedParts(at, s.timezone)
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
          key: `${s.slotId}:${s.sessionDate}`,
          groupName: s.groupName,
          gymName: s.gym?.name ?? null,
          slotId: s.slotId,
          sessionDate: s.sessionDate,
          sessionId: null,
          startTime: `${pad2(day.hour)}:${pad2(day.minute)}`,
          note: "Замена",
        },
      },
    ]
  })

/**
 * The classes today's timetable gives the groups this user coaches (cancelled
 * ones dropped), the classes they run today as a substitute, plus their
 * confirmed personal sessions as the coach, earliest first. «Today» is each
 * group's (or session's) own zone's day. An own class somebody else
 * substitutes stays (its coaches keep marking rights), noted «Замена: …».
 */
export const pickCoachClassesToday = (
  groups: readonly MyGroup[],
  now: Date,
  personal: readonly PersonalTraining[] = [],
  meId: string | null = null,
  substitutions: readonly ClassSubstitution[] = [],
): CoachClassToday[] => {
  const substituteOf = new Map(
    substitutions
      .filter((s) => s.status === "APPROVED")
      .map((s) => [`${s.slotId}:${s.sessionDate}`, s.substitute]),
  )
  return [
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
              ...(substituteOf.has(`${slot.id}:${dateStr}`)
                ? {
                    note: `Замена: ${shortPersonName(substituteOf.get(`${slot.id}:${dateStr}`)!)}`,
                  }
                : {}),
            },
          }
        })
      }),
    ...(meId ? pickCoachPersonalToday(personal, meId, now) : []),
    ...(meId ? pickSubstitutionsToday(substitutions, meId, now) : []),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((x) => x.item)
}

