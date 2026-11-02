// Wall-clock arithmetic for the event form: dates are local-midnight Date
// objects from the DatePicker, times are "HH:MM" strings.

export type WallClock = { date: Date; time: string }

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
}

// Days are counted by calendar fields, not milliseconds, so a DST switch
// between the two dates can't skew the result by an hour.
const dayIndex = (d: Date): number =>
  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000

const totalMinutes = (w: WallClock): number =>
  dayIndex(w.date) * 1440 + toMinutes(w.time)

// Moving the start keeps the event's length: the end moves by the same
// amount. A non-positive length (end before start) collapses to zero
// rather than carrying the inversion along.
export const shiftEndWithStart = (
  prevStart: WallClock,
  prevEnd: WallClock,
  nextStart: WallClock,
): WallClock => {
  const duration = Math.max(0, totalMinutes(prevEnd) - totalMinutes(prevStart))
  const end = totalMinutes(nextStart) + duration
  const days = Math.floor(end / 1440)
  const minutes = end - days * 1440
  const utc = new Date(days * 86_400_000)
  return {
    date: new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()),
    time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
  }
}
