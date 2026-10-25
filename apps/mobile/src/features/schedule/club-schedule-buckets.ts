import type {
  ScheduleEvent,
  ScheduleSession,
  WorkspaceSchedule,
} from "../../shared/api/groups"
import type { PersonalTraining } from "../../shared/api/personal-trainings"

// Returns a Date pointing to the start of the local-day for the given
// date. Used to bucket sessions by calendar day in workspace TZ. We
// take the date string from the session's startAt (in workspace TZ) so
// users in other zones don't shift sessions across days.
export const formatTimeInTz = (
  iso: string,
  timeZone: string,
): { hourMinute: string; dateKey: string; dayLabel: string } => {
  // Intl.DateTimeFormat is the most reliable way to render a UTC instant
  // in an arbitrary IANA zone without pulling another dep.
  const d = new Date(iso)
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>(
    (acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value
      return acc
    },
    {},
  )
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`
  const hourMinute = `${parts.hour}:${parts.minute}`
  // weekday returns the name in the locale we asked for ("понедельник");
  // we keep the lowercase form for the section header.
  const dayLabel = parts.weekday ?? ""
  return { hourMinute, dateKey, dayLabel }
}

export type DayBucket = {
  dateKey: string
  dayLabel: string
  // Display date as DD.MM so the header doesn't overflow on Sunday.
  dateShort: string
  sessions: ScheduleSession[]
  events: ScheduleEvent[]
  // Confirmed personal sessions (the viewer is a participant).
  personal: PersonalTraining[]
}

export const buildDayBuckets = (
  schedule: WorkspaceSchedule,
  days = 14,
  now: number = Date.now(),
  personal: PersonalTraining[] = [],
): DayBucket[] => {
  // Walk calendar days in the WORKSPACE timezone, not the device's. If a
  // Tomsk user (UTC+7) opens a Moscow workspace (UTC+3), iterating in
  // device-local time gives a date label that's the day BEFORE the
  // workspace-local date the same instant maps to. Sessions then land in
  // the right bucket key (which is built in workspace TZ from
  // session.startAt) but the bucket's label reads as the previous day,
  // so a Saturday slot shows up under "Пятница".
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: schedule.timezone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const buckets = new Map<string, DayBucket>()
  const baseTs = now
  for (let i = 0; i < days; i++) {
    // Stepping by 86 400 000 ms is fine across DST — the worst case
    // shifts the instant by 1h, never enough to skip a calendar day
    // given we anchor to the current moment.
    const parts = fmt
      .formatToParts(new Date(baseTs + i * 86_400_000))
      .reduce<Record<string, string>>((acc, p) => {
        if (p.type !== "literal") acc[p.type] = p.value
        return acc
      }, {})
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`
    if (buckets.has(dateKey)) continue
    buckets.set(dateKey, {
      dateKey,
      dayLabel: parts.weekday ?? "",
      dateShort: `${parts.day}.${parts.month}`,
      sessions: [],
      events: [],
      personal: [],
    })
  }

  for (const session of schedule.sessions) {
    // Bucket sessions by their own timezone. For multi-city clubs each
    // gym ships its own tz, so a Tomsk gym session lands under the
    // calendar day a Tomsk learner would expect even if the workspace
    // default is Moscow.
    const { dateKey } = formatTimeInTz(session.startAt, session.timezone)
    buckets.get(dateKey)?.sessions.push(session)
  }
  for (const event of schedule.events) {
    // Bucket events by their OWN timezone — that's the day the
    // organiser meant. Around midnight, an event tagged as Friday in
    // Asia/Krasnoyarsk may map to Saturday in workspace TZ; we honour
    // the organiser's day, not the workspace's interpretation.
    const { dateKey } = formatTimeInTz(event.startAt, event.timezone)
    buckets.get(dateKey)?.events.push(event)
  }
  for (const pt of personal) {
    if (!pt.confirmedStartAt) continue
    // Like an event, the day the session was agreed in its own zone — the
    // request carries the zone its wall-clock times were entered in.
    const { dateKey } = formatTimeInTz(pt.confirmedStartAt, pt.timezone)
    buckets.get(dateKey)?.personal.push(pt)
  }
  return [...buckets.values()]
}

// Days with nothing on them are dropped from the list: fourteen rows of «—»
// buried the few days that actually have a class.
export const withClasses = (buckets: DayBucket[]): DayBucket[] =>
  buckets.filter(
    (b) =>
      b.sessions.length > 0 || b.events.length > 0 || b.personal.length > 0,
  )

// «GMT+3» instead of the raw IANA id («Europe/Moscow») — members don't know
// zone ids. Falls back to the id where the runtime can't format an offset.
export const formatTimezoneLabel = (timeZone: string): string => {
  try {
    const part = new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")
    return part?.value ?? timeZone
  } catch {
    return timeZone
  }
}

export type ScheduleGym = { id: string; name: string }

// Every gym that has a class or an event in the window, by name.
export const scheduleGyms = (schedule: WorkspaceSchedule): ScheduleGym[] => {
  const byId = new Map<string, ScheduleGym>()
  for (const s of schedule.sessions) {
    const gym = s.group.gym
    if (gym) byId.set(gym.id, { id: gym.id, name: gym.name })
  }
  for (const e of schedule.events) {
    if (e.gym) byId.set(e.gym.id, { id: e.gym.id, name: e.gym.name })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

// Keeps one gym's classes. A club-wide event (no gym) belongs to every gym, so
// it stays under any filter. `null` = «Все залы».
export const filterScheduleByGym = (
  schedule: WorkspaceSchedule,
  gymId: string | null,
): WorkspaceSchedule => {
  if (!gymId) return schedule
  return {
    ...schedule,
    sessions: schedule.sessions.filter((s) => s.group.gym?.id === gymId),
    events: schedule.events.filter((e) => !e.gym || e.gym.id === gymId),
  }
}

// A stored gym that has since left the schedule falls back to «Все залы».
export const resolveGymFilter = (
  stored: string | null,
  gyms: ScheduleGym[],
): string | null =>
  stored && gyms.some((g) => g.id === stored) ? stored : null

// The «Мои группы» chip shares the gym filter's stored value: a sentinel that
// can't be a gym id (those are uuids).
export const MY_GROUPS_FILTER = "my-groups"

// Keeps the classes of the member's own groups (as a student or as a coach).
// Events belong to no group, so they drop out of this view.
export const filterScheduleByGroups = (
  schedule: WorkspaceSchedule,
  groupIds: ReadonlySet<string>,
): WorkspaceSchedule => ({
  ...schedule,
  sessions: schedule.sessions.filter((s) => groupIds.has(s.groupId)),
  events: [],
})

// A stored «Мои группы» survives only while the member has a group; otherwise
// (or for a stored gym) the gym rules apply. With fewer than two gyms there is
// no gym to pick, so a stored one counts as «everything».
export const resolveScheduleFilter = (
  stored: string | null,
  gyms: ScheduleGym[],
  hasOwnGroups: boolean,
): string | null =>
  stored === MY_GROUPS_FILTER
    ? hasOwnGroups
      ? MY_GROUPS_FILTER
      : null
    : gyms.length < 2
      ? null
      : resolveGymFilter(stored, gyms)

// The filter chips: «Мои группы» (when the member has one), then «Все залы» and
// one chip per gym. A club with a single gym has nothing to tell apart, so it
// gets «Всё расписание» and no gym chip.
export const scheduleChips = (
  gyms: ScheduleGym[],
  hasOwnGroups: boolean,
): Array<{ id: string | null; name: string }> => [
  ...(hasOwnGroups ? [{ id: MY_GROUPS_FILTER, name: "Мои группы" }] : []),
  ...(gyms.length >= 2
    ? [{ id: null, name: "Все залы" }, ...gyms]
    : [{ id: null, name: "Всё расписание" }]),
]

// Applies whichever chip is selected: «Мои группы», a gym, or null = everything.
export const filterSchedule = (
  schedule: WorkspaceSchedule,
  filter: string | null,
  ownGroupIds: ReadonlySet<string>,
): WorkspaceSchedule =>
  filter === MY_GROUPS_FILTER
    ? filterScheduleByGroups(schedule, ownGroupIds)
    : filterScheduleByGym(schedule, filter)
