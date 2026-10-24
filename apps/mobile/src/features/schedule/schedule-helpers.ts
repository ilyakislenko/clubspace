import type {
  GroupScheduleException,
  GroupScheduleSlot,
} from "../../shared/api/groups"

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
): GroupScheduleException | null => {
  const todayStr = isoDateString(today)
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
  // Local Date for the next occurrence (interpretation is device-local —
  // good enough for MVP since most students train in the gym's TZ).
  startAt: Date
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
): NextSession | null => {
  if (slots.length === 0) return null
  for (let offset = 0; offset < 14; offset++) {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
    )
    const dateStr = isoDateString(date)
    const isoDow = isoDayOfWeek(date)

    // Collect every slot whose weekday matches this calendar date and
    // who's effectively running today, then pick the earliest by time
    // — relevant when several slots share a day (Tue 18:00 + Tue 20:00).
    const candidates = slots
      .filter((s) => s.dayOfWeek === isoDow && slotEffectiveOn(s, dateStr))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    for (const slot of candidates) {
      const { hour, minute } = parseHHMM(slot.startTime)
      const startAt = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour,
        minute,
      )
      // For "today" candidates, skip slots that already finished — the
      // next session shouldn't say "Сегодня в 19:00" if it's already
      // 21:00 in the gym.
      if (offset === 0) {
        const endAt = new Date(startAt.getTime() + slot.durationMin * 60_000)
        if (endAt <= now) continue
      }
      if (findExceptionForSlot(exceptions, slot, dateStr)) continue
      return { slot, startAt, dateStr, daysAhead: offset }
    }
  }
  return null
}

export const formatSlotShort = (slot: GroupScheduleSlot): string =>
  `${DAY_SHORT[slot.dayOfWeek]} ${slot.startTime}`

export const formatNextSessionLabel = (next: NextSession): string => {
  const when =
    next.daysAhead === 0
      ? "Сегодня"
      : next.daysAhead === 1
        ? "Завтра"
        : `В ${DAY_LONG[isoDayOfWeek(next.startAt)]}`
  return `${when} в ${next.slot.startTime}`
}

// The occurrence a coach would mark attendance for right now: today's
// non-cancelled slots, preferring the latest one that has already started
// (so a coach finishing a class isn't sent to the evening one) and falling
// back to the earliest upcoming one. Null when nothing runs today.
export const findTodaySlot = (
  slots: GroupScheduleSlot[],
  exceptions: GroupScheduleException[],
  now: Date = new Date(),
): { slot: GroupScheduleSlot; dateStr: string } | null => {
  const dateStr = isoDateString(now)
  const isoDow = isoDayOfWeek(now)
  const today = slots
    .filter(
      (s) =>
        s.dayOfWeek === isoDow &&
        slotEffectiveOn(s, dateStr) &&
        !findExceptionForSlot(exceptions, s, dateStr),
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  if (today.length === 0) return null
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`
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
