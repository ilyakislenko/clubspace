import type {
  ScheduleEvent,
  ScheduleSession,
  WorkspaceSchedule,
} from "../../shared/api/groups"

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
}

export const buildDayBuckets = (
  schedule: WorkspaceSchedule,
  days = 14,
  now: number = Date.now(),
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
  return [...buckets.values()]
}

// Days with nothing on them are dropped from the list: fourteen rows of «—»
// buried the few days that actually have a class.
export const withClasses = (buckets: DayBucket[]): DayBucket[] =>
  buckets.filter((b) => b.sessions.length > 0 || b.events.length > 0)

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
