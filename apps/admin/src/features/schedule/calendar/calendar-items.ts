import type {
  ScheduleEvent,
  ScheduleSession,
} from "../../../shared/api/schedule"
import {
  ALL_DIRECTIONS,
  matchesDirectionFilter,
  type DirectionFilterValue,
} from "../../directions/DirectionFilter"
import { wallClock } from "./calendar-helpers"

// What the calendar draws: a dated class of a group or a club event, placed on
// one club calendar day by its own wall-clock (a gym may sit in another zone).
type ItemBase = {
  key: string
  date: string
  startMin: number
  endMin: number
  title: string
  color: string | null
  gymId: string | null
  // Who is busy with it — the group's coach, or the approved substitute.
  coachIds: string[]
  cancelled: boolean
  // The viewer may move / resize / cancel it.
  editable: boolean
}

export type ClassItem = ItemBase & { kind: "class"; session: ScheduleSession }
export type EventItem = ItemBase & { kind: "event"; event: ScheduleEvent }
export type CalendarItem = ClassItem | EventItem

export const ALL = "all"

export type CalendarFilters = {
  gymId: string
  directionId: DirectionFilterValue
  coachId: string
  groupId: string
}

export const EMPTY_FILTERS: CalendarFilters = {
  gymId: ALL,
  directionId: ALL_DIRECTIONS,
  coachId: ALL,
  groupId: ALL,
}

export const activeFilterCount = (f: CalendarFilters): number =>
  [f.gymId !== ALL, f.directionId !== ALL_DIRECTIONS, f.coachId !== ALL, f.groupId !== ALL].filter(Boolean).length

const sessionCoachIds = (s: ScheduleSession): string[] => {
  const sub = s.substitution
  return sub?.status === "APPROVED" ? [sub.substitute.id] : [s.group.coach.id]
}

export const toClassItem = (
  s: ScheduleSession,
  editable: boolean,
): ClassItem => {
  const start = wallClock(s.startAt, s.timezone)
  return {
    kind: "class",
    key: s.occurrenceId,
    date: start.ymd,
    startMin: start.minutes,
    // A class never crosses midnight (the server refuses such slots).
    endMin: start.minutes + s.durationMin,
    title: s.group.name,
    color: s.group.direction?.color ?? null,
    gymId: s.group.gym?.id ?? null,
    coachIds: sessionCoachIds(s),
    cancelled: s.cancelled,
    editable: editable && !s.cancelled,
    session: s,
  }
}

const toEventItem = (e: ScheduleEvent): EventItem => {
  const start = wallClock(e.startAt, e.timezone)
  const end = wallClock(e.endAt, e.timezone)
  return {
    kind: "event",
    key: `event:${e.id}`,
    date: start.ymd,
    startMin: start.minutes,
    // A multi-day event is drawn on its first day up to midnight.
    endMin:
      end.ymd === start.ymd
        ? Math.max(end.minutes, start.minutes + 15)
        : 24 * 60,
    title: e.title,
    color: e.direction?.color ?? null,
    gymId: e.gym?.id ?? null,
    coachIds: e.coach ? [e.coach.id] : [],
    cancelled: false,
    editable: false,
    event: e,
  }
}

export const buildCalendarItems = (
  schedule: { sessions: ScheduleSession[]; events: ScheduleEvent[] },
  opts: {
    filters: CalendarFilters
    canEdit: (s: ScheduleSession) => boolean
    // A plain coach sees only their own groups; null = every group.
    onlyGroupIds: ReadonlySet<string> | null
  },
): CalendarItem[] => {
  const f = opts.filters
  const items: CalendarItem[] = []
  for (const s of schedule.sessions) {
    // The cancelled original of a moved class: the moved one carries the story.
    if (s.rescheduledTo) continue
    if (opts.onlyGroupIds && !opts.onlyGroupIds.has(s.groupId)) continue
    if (f.groupId !== ALL && s.groupId !== f.groupId) continue
    if (f.gymId !== ALL && s.group.gym?.id !== f.gymId) continue
    if (!matchesDirectionFilter(f.directionId, s.group.direction?.id)) continue
    const item = toClassItem(s, opts.canEdit(s))
    if (f.coachId !== ALL && !item.coachIds.includes(f.coachId) && s.group.coach.id !== f.coachId) continue
    items.push(item)
  }
  if (f.groupId === ALL) {
    for (const e of schedule.events) {
      if (f.gymId !== ALL && e.gym?.id !== f.gymId) continue
      if (!matchesDirectionFilter(f.directionId, e.direction?.id)) continue
      if (f.coachId !== ALL && e.coach?.id !== f.coachId) continue
      items.push(toEventItem(e))
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.title.localeCompare(b.title, "ru"))
  return items
}

export const groupByDate = <T extends { date: string }>(
  items: readonly T[],
): Map<string, T[]> => {
  const out = new Map<string, T[]>()
  for (const it of items) {
    const list = out.get(it.date)
    if (list) list.push(it)
    else out.set(it.date, [it])
  }
  return out
}

// «11/12» for a booking class, «+2 гостя» style is left to the block.
export const fillLabel = (s: ScheduleSession): string | null => {
  if (!s.booking) return null
  return s.booking.capacity === null
    ? String(s.booking.booked)
    : `${s.booking.booked}/${s.booking.capacity}`
}

export const isFull = (s: ScheduleSession): boolean =>
  !!s.booking && s.booking.capacity !== null && s.booking.booked >= s.booking.capacity
