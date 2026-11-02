import type { WorkspaceSchedule } from "../../shared/api/groups"

// An instant's wall clock, calendar day and weekday in `timeZone` — a class
// renders in its own zone so users in other zones don't see it shifted.
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

// «GMT+7» instead of the raw IANA id («Asia/Tomsk») — members don't know
// zone ids. The offset is computed from the zone's wall clock rather than
// `timeZoneName: "shortOffset"`: Hermes on iOS answers plain «GMT» for every
// zone there. Falls back to the id where the runtime can't resolve the zone.
export const formatTimezoneLabel = (
  timeZone: string,
  now: Date = new Date(),
): string => {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      })
        .formatToParts(now)
        .map((p) => [p.type, Number(p.value)] as const),
    )
    const wall = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    )
    const utc = Math.floor(now.getTime() / 60_000) * 60_000
    const minutes = Math.round((wall - utc) / 60_000)
    if (!Number.isFinite(minutes)) return timeZone
    if (minutes === 0) return "GMT"
    const abs = Math.abs(minutes)
    const mm = abs % 60
    const tail = mm ? `:${String(mm).padStart(2, "0")}` : ""
    return `GMT${minutes < 0 ? "-" : "+"}${Math.floor(abs / 60)}${tail}`
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
