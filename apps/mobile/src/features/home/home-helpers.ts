import { agree, type SessionNoun } from "@clubspace/ui-kit/brand"

import type { Announcement } from "../../shared/api/announcements"
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
  findNextAcrossGroups,
  formatNextSessionLabel,
  listTodaySlots,
  parseHHMM,
  zonedParts,
  withoutGymEcho,
  zonedWallTimeToDate,
  type NextAcrossGroups,
} from "../schedule/schedule-helpers"
import {
  DEFAULT_PERSONAL_MIN,
  shortPersonName,
} from "../schedule/schedule-calendar"

/** First name for the greeting, or null when the member hasn't set one. */
export const greetingName = (
  me: { firstname?: string | null } | null | undefined,
): string | null => me?.firstname?.trim() || null

/**
 * The «nothing to show yet» card: when none of the club's cards can render
 * anything (no class card, attendance, subscription, announcement) and there
 * is nothing to continue watching, Home would otherwise be a bare header.
 * `hasClassCard` is whether a class block («Ближайшая», «Сегодня вы ведёте»)
 * is actually on screen — the groups feature alone isn't one: staff with no
 * group of theirs get neither.
 */
export const showHomeFallback = (opts: {
  hasClassCard: boolean
  attendanceOn: boolean
  subscriptionOn: boolean
  hasRecents: boolean
  hasAnnouncement: boolean
}): boolean =>
  !opts.hasClassCard &&
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
// «Оплачено» / «В листе ожидания, место №2» (as the class sheet says it).
// `onlinePayment`: the club takes this
// ticket online (the card opens the event, where the button is).
export const eventStatusLine = (
  mine: MyEventRegistration,
  price: number | null | undefined,
  onlinePayment = false,
): string => {
  if (mine.status === "WAITLISTED") {
    return mine.waitlistPosition
      ? `В листе ожидания, место №${mine.waitlistPosition}`
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

/** Self check-in opens this long before a class starts… */
export const CHECK_IN_LEAD_MIN = 30
/** …and stays open this long after it ends (a code read out at the bow). */
export const CHECK_IN_GRACE_MIN = 30

const DAY_MS = 24 * 60 * 60 * 1000

// Start and end (epoch ms) of a student group's classes on the club calendar
// day of `now` and the day before (a late class runs past midnight).
const groupClassSpans = (
  g: MyGroup,
  now: Date,
): Array<{ start: number; end: number }> =>
  [now, new Date(now.getTime() - DAY_MS)].flatMap((day) => {
    const { slots, dateStr } = listTodaySlots(
      g.slots,
      g.exceptions,
      day,
      g.timezone,
    )
    const [year, month, date] = dateStr.split("-").map(Number)
    return slots.map((slot) => {
      const { hour, minute } = parseHHMM(slot.startTime)
      const start = zonedWallTimeToDate(
        year!,
        month!,
        date!,
        hour,
        minute,
        g.timezone,
      ).getTime()
      return { start, end: start + slot.durationMin * 60_000 }
    })
  })

/**
 * Whether Home offers «Отметиться на тренировке» now: from
 * {@link CHECK_IN_LEAD_MIN} before one of the member's classes starts until
 * {@link CHECK_IN_GRACE_MIN} after it ends — their student groups' timetable,
 * guest bookings, held places in «Запись на занятие» classes and events.
 * The server takes a code within 12 h of the class start, so this window sits
 * well inside it and a phone clock a few minutes off still gets through.
 * Without a student group with a timetable (staff with no groups of theirs,
 * groups off, a guest) the app can't tell when they train, so the button
 * stays: the code alone decides. Bookings and events only add windows to a
 * timetable, never take the button away on their own.
 * `classBookings`: the upcoming ones plus history — the server moves a held
 * place to history the moment its class ends, and the grace still covers it.
 */
export const checkInOpenNow = (
  mine: {
    groups: readonly MyGroup[]
    bookings: readonly DropInBooking[]
    classBookings: readonly ClassBooking[]
    events: readonly ScheduleEvent[]
  },
  now: Date,
): boolean => {
  const studentGroups = mine.groups.filter(
    (g) => g.role !== "coach" && g.slots.length > 0,
  )
  if (studentGroups.length === 0) return true
  const events = mine.events.filter(
    (e) => e.registration?.mine && e.registration.mine.status !== "CANCELLED",
  )
  const spans = [
    ...studentGroups.flatMap((g) => groupClassSpans(g, now)),
    ...mine.bookings
      .filter((b) => !b.cancelled)
      .map((b) => ({
        start: new Date(b.startAt).getTime(),
        end: new Date(b.endAt).getTime(),
      })),
    ...mine.classBookings
      .filter((b) => b.status === "BOOKED" && !b.classCancelled)
      .map((b) => ({
        start: new Date(b.startAt).getTime(),
        end: new Date(b.endAt).getTime(),
      })),
    ...events.map((e) => ({
      start: new Date(e.startAt).getTime(),
      end: new Date(e.endAt).getTime(),
    })),
  ]
  const t = now.getTime()
  return spans.some(
    ({ start, end }) =>
      start - CHECK_IN_LEAD_MIN * 60_000 <= t &&
      t <= end + CHECK_IN_GRACE_MIN * 60_000,
  )
}

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
  // When it starts and ends (epoch ms): what is on now, what is over.
  startsAt: number
  endsAt: number
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
    const endsAt =
      at.getTime() + (pt.confirmedDurationMin ?? DEFAULT_PERSONAL_MIN) * 60_000
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
          startsAt: at.getTime(),
          endsAt,
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
          groupName: withoutGymEcho(s.groupName, s.gym ?? null),
          gymName: s.gym?.name ?? null,
          slotId: s.slotId,
          sessionDate: s.sessionDate,
          sessionId: null,
          startTime: `${pad2(day.hour)}:${pad2(day.minute)}`,
          startsAt: at.getTime(),
          endsAt: new Date(s.endAt).getTime(),
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
          const at = zonedWallTimeToDate(year!, month!, day!, hour, minute, g.timezone)
          return {
            at,
            item: {
              key: `${slot.id}:${dateStr}`,
              groupName: withoutGymEcho(g.name, g.gym ?? null),
              gymName: g.gym?.name ?? null,
              slotId: slot.id,
              sessionDate: dateStr,
              sessionId: null,
              startTime: slot.startTime,
              startsAt: at.getTime(),
              endsAt: at.getTime() + slot.durationMin * 60_000,
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

/** Rows «Сегодня вы ведёте» shows before «Все тренировки сегодня». */
export const COACH_TODAY_ROWS = 3
/** «Отметить» appears this long before a class starts. */
export const MARK_LEAD_MIN = 30

export type CoachTodayView = {
  // What is on now, then what comes next; at most `limit`.
  rows: CoachClassToday[]
  // Over already, earliest first: folded into «Прошло: N».
  finished: CoachClassToday[]
  // Later classes beyond the rows.
  hidden: number
}

/**
 * Splits today's classes (earliest first, as {@link pickCoachClassesToday}
 * returns them) into the rows the block shows — in progress, then upcoming —
 * the finished ones and how many later ones don't fit.
 */
export const coachTodayView = (
  classes: readonly CoachClassToday[],
  now: Date,
  limit = COACH_TODAY_ROWS,
): CoachTodayView => {
  const t = now.getTime()
  const finished = classes.filter((c) => c.endsAt <= t)
  const open = classes.filter((c) => c.endsAt > t)
  return {
    rows: open.slice(0, limit),
    finished,
    hidden: Math.max(0, open.length - limit),
  }
}

/** A class is markable once it has started or starts within the lead time. */
export const canMarkClassNow = (
  c: Pick<CoachClassToday, "startsAt">,
  now: Date,
): boolean =>
  c.startsAt - MARK_LEAD_MIN * 60_000 <= now.getTime()

/** A class that has started and not yet ended. */
export const isClassInProgress = (c: CoachClassToday, now: Date): boolean =>
  c.startsAt <= now.getTime() && now.getTime() < c.endsAt

/**
 * The coach's next own group class once today holds nothing more to run (no
 * class today, or all of them over): the today block's «Следующая — …» line.
 * Null while a class today is still on or ahead.
 */
export const coachNextAfterToday = (
  groups: readonly MyGroup[],
  today: readonly CoachClassToday[],
  now: Date,
): NextAcrossGroups | null =>
  today.some((c) => c.endsAt > now.getTime())
    ? null
    : findNextAcrossGroups(
        groups.filter((g) => g.role === "coach"),
        now,
      )

/**
 * «Следующая — завтра в 12:00, Дети 6–9», plus the club's zone when it isn't
 * the device's (`device` defaults to the device's own).
 */
export const coachNextLine = (
  next: NextAcrossGroups,
  session: SessionNoun,
  device?: string,
): string => {
  const when = formatNextSessionLabel(next.next, device)
  return `${agree(session, "Следующая", "Следующее")} — ${when.charAt(0).toLowerCase()}${when.slice(1)}, ${next.group.name}`
}

/** How long a non-pinned announcement stays on Home after it is published. */
export const ANNOUNCEMENT_HOME_DAYS = 7

/**
 * Home shows the latest announcement only while it is news: pinned, or
 * published within {@link ANNOUNCEMENT_HOME_DAYS}. Older ones stay in
 * «Объявления».
 */
export const showAnnouncementOnHome = (
  item: Pick<Announcement, "pinned" | "publishedAt" | "createdAt">,
  now: Date,
): boolean =>
  item.pinned ||
  now.getTime() - Date.parse(item.publishedAt ?? item.createdAt) <=
    ANNOUNCEMENT_HOME_DAYS * 86_400_000

/**
 * The bell's count for its accessibility label: nothing for zero, «9+» past
 * one digit (the bell itself shows only a dot).
 */
export const formatBellCount = (count: number): string | null =>
  count <= 0 ? null : count > 9 ? "9+" : String(count)
