import { zonedParts } from "../schedule/schedule-helpers"

const pad = (n: number) => String(n).padStart(2, "0")

/** "YYYY-MM" of a date in the device calendar. */
export const yearMonth = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

/** Shift a "YYYY-MM" by `delta` months (handles year wrap). */
export const addMonths = (ym: string, delta: number): string => {
  const [y, m] = ym.split("-").map(Number)
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`
}

const daysInMonth = (ym: string): number => {
  const [y, m] = ym.split("-").map(Number)
  return new Date(y, m, 0).getDate()
}

/** First and last calendar day of "YYYY-MM" as "YYYY-MM-DD" (Feb in leap years). */
export const monthRange = (ym: string): { from: string; to: string } => ({
  from: `${ym}-01`,
  to: `${ym}-${pad(daysInMonth(ym))}`,
})

/** Weeks of the month, Monday first; null pads days outside the month. Each row has 7 cells. */
export const monthGrid = (ym: string): (number | null)[][] => {
  const [y, m] = ym.split("-").map(Number)
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth(ym) }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const rows: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
  return rows
}

type DatedSession = { startAt: string; timezone: string }

const addDays = (date: string, delta: number): string => {
  const [y, m, d] = date.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + delta))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * The query window for a month of attendance. The server windows by UTC
 * dates while a month is read in each club's own zone, so the window reaches
 * one day past each end and `inMonth` trims it. The current month sends no
 * `to`: the server then ends at "now", which covers tonight's class on a
 * device behind UTC.
 */
export const monthWindow = (
  ym: string,
  now: Date,
): { from: string; to?: string } => {
  const { from, to } = monthRange(ym)
  if (ym === yearMonth(now)) return { from: addDays(from, -1) }
  return { from: addDays(from, -1), to: addDays(to, 1) }
}

/** Day of month of a session's start in the session's own zone, or null outside `ym`. */
const dayInMonth = (s: DatedSession, ym: string): number | null => {
  const p = zonedParts(new Date(s.startAt), s.timezone)
  return `${p.year}-${pad(p.month)}` === ym ? p.day : null
}

/** The sessions that started in `ym`, each in its own club's zone. */
export const inMonth = <T extends DatedSession>(sessions: T[], ym: string): T[] =>
  sessions.filter((s) => dayInMonth(s, ym) !== null)

/** Day-of-month → sessions that day, for sessions whose start (in the session's own IANA tz) falls in `ym`. */
export const attendedDays = (
  sessions: DatedSession[],
  ym: string,
): Map<number, number> => {
  const days = new Map<number, number>()
  for (const s of sessions) {
    const day = dayInMonth(s, ym)
    if (day !== null) days.set(day, (days.get(day) ?? 0) + 1)
  }
  return days
}
