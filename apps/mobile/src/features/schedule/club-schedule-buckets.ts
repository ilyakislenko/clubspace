import type { WorkspaceSchedule } from "../../shared/api/groups"
import { pluralRu } from "../../shared/format-ru"

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

// Keeps the picked gyms' classes. A club-wide event (no gym) belongs to every
// gym, so it stays under any filter. [] = «Все залы».
export const filterScheduleByGym = (
  schedule: WorkspaceSchedule,
  gymIds: readonly string[],
): WorkspaceSchedule => {
  if (gymIds.length === 0) return schedule
  return {
    ...schedule,
    sessions: schedule.sessions.filter(
      (s) => !!s.group.gym && gymIds.includes(s.group.gym.id),
    ),
    events: schedule.events.filter((e) => !e.gym || gymIds.includes(e.gym.id)),
  }
}

// «Мои группы» is stored like the gyms, as the filter's only id: a sentinel
// that can't be a gym id (those are uuids).
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

// The stored filter as it applies now: «Мои группы» survives only while the
// member has a group; stored gyms that have left the schedule drop out, in the
// gyms' order. With fewer than two gyms there is no gym to pick, and picking
// every gym is «Все залы» — both read as everything ([]).
export const resolveScheduleFilter = (
  stored: readonly string[],
  gyms: ScheduleGym[],
  hasOwnGroups: boolean,
): string[] => {
  if (stored.includes(MY_GROUPS_FILTER)) {
    return hasOwnGroups ? [MY_GROUPS_FILTER] : []
  }
  if (gyms.length < 2) return []
  const picked = gyms.filter((g) => stored.includes(g.id)).map((g) => g.id)
  return picked.length === gyms.length ? [] : picked
}

// A chip tap: «Все залы» (null) clears; «Мои группы» stands alone (picking it
// drops the gyms, tapping it again goes back to everything); a gym toggles
// and drops «Мои группы».
export const toggleScheduleFilter = (
  selected: readonly string[],
  id: string | null,
  gyms: ScheduleGym[],
  hasOwnGroups: boolean,
): string[] => {
  if (id === null) return []
  if (id === MY_GROUPS_FILTER) {
    return selected.includes(MY_GROUPS_FILTER) ? [] : [MY_GROUPS_FILTER]
  }
  const picked = selected.filter((s) => s !== MY_GROUPS_FILTER)
  return resolveScheduleFilter(
    picked.includes(id) ? picked.filter((s) => s !== id) : [...picked, id],
    gyms,
    hasOwnGroups,
  )
}

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

// Applies the resolved filter: «Мои группы», the picked gyms, or [] = everything.
export const filterSchedule = (
  schedule: WorkspaceSchedule,
  filter: readonly string[],
  ownGroupIds: ReadonlySet<string>,
): WorkspaceSchedule =>
  filter.includes(MY_GROUPS_FILTER)
    ? filterScheduleByGroups(schedule, ownGroupIds)
    : filterScheduleByGym(schedule, filter)

/**
 * The «Фильтр» button's label: the picked directions (when the club has
 * directions) and the picked gyms / «Мои группы» (when there is a choice),
 * joined by « · ». One or two directions are named, more are counted; one gym
 * is named, more are counted (gym names run long). `active` once either
 * differs from «everything». Null when the club offers nothing to filter by.
 * Takes the resolved picks.
 */
export const scheduleFilterSummary = (opts: {
  directions: readonly { id: string; name: string }[]
  directionIds: readonly string[]
  // The gym/group chips, or null when there is no gym or group to pick.
  chips: ReadonlyArray<{ id: string | null; name: string }> | null
  filterIds: readonly string[]
}): { label: string; active: boolean } | null => {
  const parts: string[] = []
  if (opts.directions.length > 0) {
    const names = opts.directions
      .filter((d) => opts.directionIds.includes(d.id))
      .map((d) => d.name)
    parts.push(
      names.length === 0
        ? "Все направления"
        : names.length <= 2
          ? names.join(", ")
          : `${names.length} ${pluralRu(names.length, "направление", "направления", "направлений")}`,
    )
  }
  if (opts.chips) {
    const picked = opts.chips.filter(
      (c) => c.id !== null && opts.filterIds.includes(c.id),
    )
    const label =
      picked.length === 0
        ? opts.chips.find((c) => c.id === null)?.name
        : picked.length === 1
          ? picked[0].name
          : `${picked.length} ${pluralRu(picked.length, "зал", "зала", "залов")}`
    if (label) parts.push(label)
  }
  if (parts.length === 0) return null
  return {
    label: parts.join(" · "),
    active: opts.directionIds.length > 0 || opts.filterIds.length > 0,
  }
}
