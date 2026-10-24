// Formats a calendar date ("YYYY-MM-DD", no time, no zone) as e.g. "5 нояб. 2026 г.".
// Rendered in UTC so the day never shifts with the browser's timezone. Anything
// that isn't a plain date is returned unchanged.
const ymdFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

export const formatYmd = (ymd: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return ymd
  const [, y, m, d] = match
  return ymdFmt.format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))))
}
