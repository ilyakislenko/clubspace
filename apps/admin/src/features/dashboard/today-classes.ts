import type { WorkspaceSchedule } from "../../shared/api/schedule"
import {
  addDaysYmd,
  wallClock,
} from "../schedule/calendar/calendar-helpers"
import {
  buildCalendarItems,
  EMPTY_FILTERS,
  type CalendarItem,
} from "../schedule/calendar/calendar-items"

// Days the dashboard asks the schedule for: the browser's day ± 1, so the
// club's own day is inside whatever zone the browser sits in.
export const todayRequestRange = (now: Date): { from: string; to: string } => {
  const ymd = wallClock(now, Intl.DateTimeFormat().resolvedOptions().timeZone).ymd
  return { from: addDaysYmd(ymd, -1), to: addDaysYmd(ymd, 1) }
}

// A plain coach's own classes: groups they coach (primary or assistant) and
// classes they run as the approved substitute. null = every class.
export type OwnClasses = { groupIds: ReadonlySet<string>; userId: string } | null

/**
 * The club's classes and events of its own calendar day (the schedule's time
 * zone), in start order, as the calendar draws them (a moved class once, at
 * its new time). Cancelled ones stay: the coach needs to know.
 */
export const todayItems = (
  schedule: WorkspaceSchedule,
  now: Date,
  own: OwnClasses,
): { today: string; items: CalendarItem[] } => {
  const today = wallClock(now, schedule.timezone).ymd
  const items = buildCalendarItems(schedule, {
    filters: EMPTY_FILTERS,
    canEdit: () => false,
    onlyGroupIds: null,
  }).filter(
    (it) =>
      it.date === today &&
      (!own ||
        it.coachIds.includes(own.userId) ||
        (it.kind === "class" && own.groupIds.has(it.session.groupId))),
  )
  return { today, items }
}
