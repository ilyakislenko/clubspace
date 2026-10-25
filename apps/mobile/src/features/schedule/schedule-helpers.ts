import type {
  GroupScheduleException,
  GroupScheduleSlot,
  MyGroup,
} from "../../shared/api/groups"
import { formatTimezoneLabel } from "./club-schedule-buckets"

export const DAY_SHORT: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
}

export const DAY_LONG: Record<number, string> = {
  1: "понедельник",
  2: "вторник",
  3: "среду",
  4: "четверг",
  5: "пятницу",
  6: "субботу",
  7: "воскресенье",
}

// JS Date.getDay returns 0=Sun..6=Sat; ISO is 1=Mon..7=Sun.
export const isoDayOfWeek = (d: Date): number => {
  const js = d.getDay()
  return js === 0 ? 7 : js
}

const pad = (n: number) => String(n).padStart(2, "0")
export const isoDateString = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const dateStringOf = (year: number, month: number, day: number): string =>
  `${year}-${pad(month)}-${pad(day)}`
const zonedDateString = (d: Date, timeZone: string | undefined): string => {
  const p = zonedParts(d, timeZone)
  return dateStringOf(p.year, p.month, p.day)
}

// Slot times are wall-clock times in the club's IANA zone, so «today», the
// weekday and «now» must be read in that zone, not the device's. A missing
// (or unknown) zone — old cached data — falls back to the device zone.
type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>()
const zonedFormatter = (timeZone: string | undefined): Intl.DateTimeFormat => {
  const key = timeZone ?? ""
  let fmt = zonedFormatters.get(key)
  if (!fmt) {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }
    try {
      fmt = new Intl.DateTimeFormat("en-US", { ...options, timeZone })
    } catch {
      fmt = new Intl.DateTimeFormat("en-US", options)
    }
    zonedFormatters.set(key, fmt)
  }
  return fmt
}

export const zonedParts = (
  instant: Date,
  timeZone: string | undefined,
): ZonedParts => {
  const parts: Record<string, number> = {}
  for (const p of zonedFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = parseInt(p.value, 10)
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
  }
}

// Offset (zone wall-clock minus UTC) in effect at the given instant.
const zoneOffsetMs = (ms: number, timeZone: string | undefined): number => {
  const p = zonedParts(new Date(ms), timeZone)
  const minuteMs = ms - (((ms % 60_000) + 60_000) % 60_000)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - minuteMs
}

// The absolute instant at which the zone's clock reads the given wall time.
// Re-resolves the offset once so a wall time across a DST change lands on
// the right side of it.
export const zonedWallTimeToDate = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string | undefined,
): Date => {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const first = wall - zoneOffsetMs(wall, timeZone)
  return new Date(wall - zoneOffsetMs(first, timeZone))
}

// ISO weekday (1=Mon..7=Sun) of a «YYYY-MM-DD» calendar date.
const isoDayOfDateString = (dateStr: string): number => {
  const js = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  return js === 0 ? 7 : js
}

const deviceTimeZone = (): string =>
  new Intl.DateTimeFormat().resolvedOptions().timeZone

// « GMT+5» when the club's clock differs from the phone's at that instant,
// so a time that isn't the viewer's local one is never ambiguous.
export const foreignTzSuffix = (
  timeZone: string | undefined,
  at: Date,
  device: string = deviceTimeZone(),
): string => {
  if (!timeZone) return ""
  if (zoneOffsetMs(at.getTime(), timeZone) === zoneOffsetMs(at.getTime(), device))
    return ""
  return ` ${formatTimezoneLabel(timeZone)}`
}

export const parseHHMM = (hhmm: string): { hour: number; minute: number } => {
  const [h, m] = hhmm.split(":").map((p) => parseInt(p, 10))
  return { hour: h ?? 0, minute: m ?? 0 }
}

export const formatDuration = (min: number): string => {
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`
}

// True if this calendar date is inside any active exception that
// applies to the slot. slotId IS NULL on an exception means it covers
// every slot of the group in the range (vacation case).
export const findExceptionForSlot = (
  exceptions: GroupScheduleException[],
  slot: GroupScheduleSlot,
  dateStr: string,
): GroupScheduleException | null => {
  for (const e of exceptions) {
    if (e.slotId !== null && e.slotId !== slot.id) continue
    if (dateStr >= e.fromDate && dateStr <= e.untilDate) return e
  }
  return null
}

// Whole-group exception that's active right now. Used to surface
// "Тренер в отпуске" banners independent of the next-session lookup.
export const findActiveGroupException = (
  exceptions: GroupScheduleException[],
  today: Date,
  timeZone?: string,
): GroupScheduleException | null => {
  const todayStr = zonedDateString(today, timeZone)
  for (const e of exceptions) {
    if (e.slotId !== null) continue
    if (todayStr >= e.fromDate && todayStr <= e.untilDate) return e
  }
  return null
}

// Within the given slot's effectiveFrom/Until window?
const slotEffectiveOn = (slot: GroupScheduleSlot, dateStr: string): boolean => {
  if (slot.effectiveFrom && dateStr < slot.effectiveFrom) return false
  if (slot.effectiveUntil && dateStr > slot.effectiveUntil) return false
  return true
}

export type NextSession = {
  slot: GroupScheduleSlot
  // Absolute instant the occurrence starts (slot wall time in `timeZone`).
  startAt: Date
  // The club zone the slot's wall time is held in; undefined = device zone.
  timeZone?: string
  // Calendar date string of that occurrence.
  dateStr: string
  // 0 = today, 1 = tomorrow, … so the UI can pick a friendly label.
  daysAhead: number
}

// Returns the next (non-cancelled) session for any of the given slots,
// scanning forward up to 14 days. Returns null if no slot matches in
// that window — typical when the group is on vacation longer than 2
// weeks.
export const findNextSession = (
  slots: GroupScheduleSlot[],
  exceptions: GroupScheduleException[],
  now: Date = new Date(),
  timeZone?: string,
): NextSession | null => {
  if (slots.length === 0) return null
  const today = zonedParts(now, timeZone)
  for (let offset = 0; offset < 14; offset++) {
    // Walk calendar days of the club zone; UTC arithmetic is only a
    // day counter here, so DST never skips or repeats a date.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    const dateStr = dateStringOf(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
    )
    const isoDow = isoDayOfDateString(dateStr)

    // Collect every slot whose weekday matches this calendar date and
    // who's effectively running today, then pick the earliest by time
    // — relevant when several slots share a day (Tue 18:00 + Tue 20:00).
    const candidates = slots
      .filter((s) => s.dayOfWeek === isoDow && slotEffectiveOn(s, dateStr))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    for (const slot of candidates) {
      const { hour, minute } = parseHHMM(slot.startTime)
      const startAt = zonedWallTimeToDate(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        hour,
        minute,
        timeZone,
      )
      // For "today" candidates, skip slots that already finished — the
      // next session shouldn't say "Сегодня в 19:00" if it's already
      // 21:00 in the gym.
      if (offset === 0) {
        const endAt = new Date(startAt.getTime() + slot.durationMin * 60_000)
        if (endAt <= now) continue
      }
      if (findExceptionForSlot(exceptions, slot, dateStr)) continue
      return { slot, startAt, timeZone, dateStr, daysAhead: offset }
    }
  }
  return null
}

export type NextAcrossGroups = {
  next: NextSession
  group: MyGroup
}

// The soonest upcoming session over every group the member is in. Ties keep
// the earlier group in the list.
export const findNextAcrossGroups = (
  groups: MyGroup[],
  now: Date = new Date(),
): NextAcrossGroups | null => {
  let best: NextAcrossGroups | null = null
  for (const group of groups) {
    const next = findNextSession(
      group.slots,
      group.exceptions,
      now,
      group.timezone,
    )
    if (next && (!best || next.startAt < best.next.startAt)) {
      best = { next, group }
    }
  }
  return best
}

export const formatSlotShort = (slot: GroupScheduleSlot): string =>
  `${DAY_SHORT[slot.dayOfWeek]} ${slot.startTime}`

export const formatNextSessionLabel = (
  next: NextSession,
  device?: string,
): string => {
  const when =
    next.daysAhead === 0
      ? "Сегодня"
      : next.daysAhead === 1
        ? "Завтра"
        : `В ${DAY_LONG[isoDayOfDateString(next.dateStr)]}`
  return `${when} в ${next.slot.startTime}${foreignTzSuffix(next.timeZone, next.startAt, device)}`
}

// «Сегодня в 19:00» / «Завтра в 19:00» / «В пятницу в 19:00» for an absolute
// instant, read in the class's own zone (plus the foreign-zone suffix). The
// same wording as formatNextSessionLabel, for sessions that aren't a slot.
export const formatUpcomingLabel = (
  startAt: Date,
  timeZone: string,
  now: Date = new Date(),
  device?: string,
): string => {
  const p = zonedParts(startAt, timeZone)
  const dateStr = dateStringOf(p.year, p.month, p.day)
  const today = zonedParts(now, timeZone)
  const todayMs = Date.UTC(today.year, today.month - 1, today.day)
  const daysAhead = Math.round(
    (Date.UTC(p.year, p.month - 1, p.day) - todayMs) / 86_400_000,
  )
  const when =
    daysAhead === 0
      ? "Сегодня"
      : daysAhead === 1
        ? "Завтра"
        : `В ${DAY_LONG[isoDayOfDateString(dateStr)]}`
  return `${when} в ${pad(p.hour)}:${pad(p.minute)}${foreignTzSuffix(timeZone, startAt, device)}`
}

// Today's non-cancelled slots of one group (its own zone's calendar day),
// earliest first, with that day's date string.
export const listTodaySlots = (
  slots: GroupScheduleSlot[],
  exceptions: GroupScheduleException[],
  now: Date = new Date(),
  timeZone?: string,
): { slots: GroupScheduleSlot[]; dateStr: string } => {
  const nowParts = zonedParts(now, timeZone)
  const dateStr = dateStringOf(nowParts.year, nowParts.month, nowParts.day)
  const isoDow = isoDayOfDateString(dateStr)
  const today = slots
    .filter(
      (s) =>
        s.dayOfWeek === isoDow &&
        slotEffectiveOn(s, dateStr) &&
        !findExceptionForSlot(exceptions, s, dateStr),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  return { slots: today, dateStr }
}

// The occurrence a coach would mark attendance for right now: today's
// non-cancelled slots, preferring the latest one that has already started
// (so a coach finishing a class isn't sent to the evening one) and falling
// back to the earliest upcoming one. Null when nothing runs today.
export const findTodaySlot = (
  slots: GroupScheduleSlot[],
  exceptions: GroupScheduleException[],
  now: Date = new Date(),
  timeZone?: string,
): { slot: GroupScheduleSlot; dateStr: string } | null => {
  const nowParts = zonedParts(now, timeZone)
  const { slots: today, dateStr } = listTodaySlots(
    slots,
    exceptions,
    now,
    timeZone,
  )
  if (today.length === 0) return null
  const nowHHMM = `${pad(nowParts.hour)}:${pad(nowParts.minute)}`
  const started = today.filter((s) => s.startTime <= nowHHMM)
  const slot = started.length > 0 ? started[started.length - 1]! : today[0]!
  return { slot, dateStr }
}

// "четверг, 24 октября, 19:00" in the session's own timezone, so a coach
// in another zone still sees the wall-clock the class is held in.
export const formatSessionStart = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))
