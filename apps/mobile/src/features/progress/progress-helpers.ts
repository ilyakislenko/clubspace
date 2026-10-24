const pad = (n: number) => String(n).padStart(2, "0")

/** «YYYY-MM-01» .. today, in the device's calendar — the attendance range for «this month». */
export const monthToDate = (now: Date): { from: string; to: string } => {
  const ym = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  return { from: `${ym}-01`, to: `${ym}-${pad(now.getDate())}` }
}

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

/** Day-of-month → sessions that day, for sessions whose start (in the session's own IANA tz) falls in `ym`. */
export const attendedDays = (
  sessions: { startAt: string; timezone: string }[],
  ym: string,
): Map<number, number> => {
  const days = new Map<number, number>()
  for (const s of sessions) {
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: s.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(s.startAt))
    if (!local.startsWith(`${ym}-`)) continue
    const day = Number(local.slice(8, 10))
    days.set(day, (days.get(day) ?? 0) + 1)
  }
  return days
}
