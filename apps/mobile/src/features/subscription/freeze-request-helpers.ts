import { formatRuDay, formatRuDayRange } from "../../shared/format-ru"

// Pure calendar maths for the freeze request form. Every date is a club-local
// "YYYY-MM-DD" string with no zone — the server hands out the window, and the
// device never decides what "today" is for the club.

export const START_CHOICES = 31
export const UNTIL_CHOICES = 31
export const DAY_PRESETS = [7, 14, 30] as const
export const REASON_PRESETS = ["Травма", "Болезнь", "Отпуск"] as const
export const REASON_MAX = 200
export const DECLINE_COMMENT_MAX = 500

const DAY_MS = 24 * 60 * 60 * 1000

const ymdMs = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

export const addDaysYmd = (ymd: string, n: number): string =>
  new Date(ymdMs(ymd) + n * DAY_MS).toISOString().slice(0, 10)

// Both ends inclusive: 24th..30th = 7.
export const daysInclusive = (from: string, until: string): number =>
  Math.round((ymdMs(until) - ymdMs(from)) / DAY_MS) + 1

export type DayChoice = { ymd: string; label: string }

const dayLabel = (ymd: string, today: string): string =>
  ymd === today
    ? "Сегодня"
    : ymd === addDaysYmd(today, 1)
      ? "Завтра"
      : formatRuDay(ymd)

// The start dates offered: firstDate..lastDate, at most START_CHOICES of them.
export const startChoices = (window: {
  today: string
  firstDate: string
  lastDate: string
}): DayChoice[] => {
  const count = Math.min(
    START_CHOICES,
    Math.max(0, daysInclusive(window.firstDate, window.lastDate)),
  )
  return Array.from({ length: count }, (_, i) => {
    const ymd = addDaysYmd(window.firstDate, i)
    return { ymd, label: dayLabel(ymd, window.today) }
  })
}

// The last freeze day to pick for a chosen start: 1..maxDays days from it, at
// most UNTIL_CHOICES chips (longer ones are typed as a number of days).
export const untilChoices = (fromYmd: string, maxDays: number): DayChoice[] =>
  Array.from({ length: Math.min(UNTIL_CHOICES, Math.max(0, maxDays)) }, (_, i) => {
    const ymd = addDaysYmd(fromYmd, i)
    return { ymd, label: formatRuDay(ymd) }
  })

// «с 24 по 30 октября · 7 дн.»
export const requestSummary = (r: {
  fromDate: string
  untilDate: string
  days: number
}): string => `${formatRuDayRange(r.fromDate, r.untilDate)} · ${r.days} дн.`

// Mirrors the server: approving after the requested start has passed starts
// the freeze today (the freeze rules forbid past starts).
export const approvalStartYmd = (reqFromYmd: string, todayYmd: string): string =>
  reqFromYmd > todayYmd ? reqFromYmd : todayYmd
