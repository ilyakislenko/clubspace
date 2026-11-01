// Pure date / layout helpers of the schedule calendar (ported from volt's
// big-calendar, reworked for ClubSpace): every day is a club calendar day
// "YYYY-MM-DD" and every time a wall-clock minute of that day, so nothing here
// depends on the browser's timezone. Weeks start on Monday.

export type CalendarView = "day" | "week" | "month" | "year" | "agenda"

export const CALENDAR_VIEWS: readonly CalendarView[] = [
  "day",
  "week",
  "month",
  "year",
  "agenda",
]

export const isCalendarView = (v: unknown): v is CalendarView =>
  typeof v === "string" && (CALENDAR_VIEWS as readonly string[]).includes(v)

// ---- calendar days ----------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, "0")

const parseYmd = (ymd: string): Date => {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const toYmd = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

export const addDaysYmd = (ymd: string, days: number): string => {
  const d = parseYmd(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return toYmd(d)
}

export const addMonthsYmd = (ymd: string, months: number): string => {
  const d = parseYmd(ymd)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return toYmd(d)
}

export const daysBetweenYmd = (from: string, to: string): number =>
  Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000)

// ISO day of week: Mon=1..Sun=7.
export const isoDow = (ymd: string): number => {
  const d = parseYmd(ymd).getUTCDay()
  return d === 0 ? 7 : d
}

export const mondayOf = (ymd: string): string =>
  addDaysYmd(ymd, 1 - isoDow(ymd))

export const startOfMonthYmd = (ymd: string): string => `${ymd.slice(0, 7)}-01`

export const endOfMonthYmd = (ymd: string): string =>
  addDaysYmd(addMonthsYmd(startOfMonthYmd(ymd), 1), -1)

export const sameMonth = (a: string, b: string): boolean =>
  a.slice(0, 7) === b.slice(0, 7)

export const weekDays = (anchor: string): string[] => {
  const monday = mondayOf(anchor)
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i))
}

// Monday-first month grid: whole weeks covering the month (5 or 6 rows).
export const monthGridDays = (anchor: string): string[] => {
  const first = mondayOf(startOfMonthYmd(anchor))
  const last = addDaysYmd(mondayOf(endOfMonthYmd(anchor)), 6)
  const count = daysBetweenYmd(first, last) + 1
  return Array.from({ length: count }, (_, i) => addDaysYmd(first, i))
}

// Days the API is asked for in a view (inclusive).
export const viewRange = (
  view: CalendarView,
  anchor: string,
): { from: string; to: string } => {
  switch (view) {
    case "day":
      return { from: anchor, to: anchor }
    case "week": {
      const days = weekDays(anchor)
      return { from: days[0], to: days[6] }
    }
    case "month": {
      const days = monthGridDays(anchor)
      return { from: days[0], to: days[days.length - 1] }
    }
    case "agenda":
      return { from: startOfMonthYmd(anchor), to: endOfMonthYmd(anchor) }
    case "year": {
      const y = anchor.slice(0, 4)
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    }
  }
}

// The schedule endpoint serves at most 90 days per call.
export const chunkRange = (
  range: { from: string; to: string },
  maxDays = 90,
): Array<{ from: string; to: string }> => {
  const out: Array<{ from: string; to: string }> = []
  let from = range.from
  while (from <= range.to) {
    const end = addDaysYmd(from, maxDays - 1)
    const to = end < range.to ? end : range.to
    out.push({ from, to })
    from = addDaysYmd(to, 1)
  }
  return out
}

export const navigateAnchor = (
  view: CalendarView,
  anchor: string,
  direction: 1 | -1,
): string => {
  switch (view) {
    case "day":
      return addDaysYmd(anchor, direction)
    case "week":
      return addDaysYmd(anchor, 7 * direction)
    case "month":
    case "agenda":
      return addMonthsYmd(anchor, direction)
    case "year":
      return addMonthsYmd(anchor, 12 * direction)
  }
}

// ---- Russian labels -----------------------------------------------------------

const MONTHS_NOM = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
]
const MONTHS_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
]
const MONTHS_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
]
export const DOW_SHORT = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
export const DOW_LONG = [
  "",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
]

const ymdParts = (ymd: string) => ({
  y: Number(ymd.slice(0, 4)),
  m: Number(ymd.slice(5, 7)) - 1,
  d: Number(ymd.slice(8, 10)),
})

export const monthTitle = (ymd: string): string => {
  const { y, m } = ymdParts(ymd)
  return `${MONTHS_NOM[m]} ${y}`
}

export const monthName = (ymd: string): string => MONTHS_NOM[ymdParts(ymd).m]

export const monthShort = (ymd: string): string => MONTHS_SHORT[ymdParts(ymd).m]

// «3 ноября»
export const dayMonth = (ymd: string): string => {
  const { m, d } = ymdParts(ymd)
  return `${d} ${MONTHS_GEN[m]}`
}

// «вт, 3 ноября»
export const dayLabel = (ymd: string): string =>
  `${DOW_SHORT[isoDow(ymd)].toLowerCase()}, ${dayMonth(ymd)}`

export const rangeLabel = (view: CalendarView, anchor: string): string => {
  switch (view) {
    case "day":
      return `${DOW_LONG[isoDow(anchor)]}, ${dayMonth(anchor)} ${anchor.slice(0, 4)}`
    case "week": {
      const days = weekDays(anchor)
      const a = ymdParts(days[0])
      const b = ymdParts(days[6])
      if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS_GEN[b.m]} ${b.y}`
      if (a.y === b.y)
        return `${dayMonth(days[0])} – ${dayMonth(days[6])} ${b.y}`
      return `${dayMonth(days[0])} ${a.y} – ${dayMonth(days[6])} ${b.y}`
    }
    case "month":
    case "agenda":
      return `1–${ymdParts(endOfMonthYmd(anchor)).d} ${MONTHS_GEN[ymdParts(anchor).m]} ${anchor.slice(0, 4)}`
    case "year":
      return anchor.slice(0, 4)
  }
}

// ---- wall clock ----------------------------------------------------------------

export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

export const formatHm = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`

export const formatRange = (startMin: number, endMin: number): string =>
  `${formatHm(startMin)}–${formatHm(endMin)}`

const partsCache = new Map<string, Intl.DateTimeFormat>()
const fmtFor = (tz: string): Intl.DateTimeFormat => {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
    partsCache.set(tz, f)
  }
  return f
}

// The calendar day and minute of the day an instant has in `tz`.
export const wallClock = (
  instant: string | Date,
  tz: string,
): { ymd: string; minutes: number } => {
  const parts = fmtFor(tz).formatToParts(
    typeof instant === "string" ? new Date(instant) : instant,
  )
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  const hour = Number(get("hour")) % 24
  return {
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  }
}

// ---- time grid -------------------------------------------------------------------

export const HOUR_HEIGHT = 96
export const SNAP_MINUTES = 15
export const PX_PER_MINUTE = HOUR_HEIGHT / 60

export const snapMinutes = (minutes: number, step = SNAP_MINUTES): number =>
  Math.round(minutes / step) * step

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))

export type HourRange = { from: number; to: number }

// The visible hours of the grid: the configured range, widened to fit every
// item so nothing is cut off.
export const visibleHours = (
  configured: HourRange,
  items: ReadonlyArray<{ startMin: number; endMin: number }>,
): HourRange => {
  let from = configured.from
  let to = configured.to
  for (const it of items) {
    from = Math.min(from, Math.floor(it.startMin / 60))
    to = Math.max(to, Math.ceil(it.endMin / 60))
  }
  return { from: clamp(from, 0, 23), to: clamp(Math.max(to, from + 1), 1, 24) }
}

export const minuteToY = (minutes: number, range: HourRange): number =>
  (minutes - range.from * 60) * PX_PER_MINUTE

export const yToMinute = (y: number, range: HourRange): number =>
  y / PX_PER_MINUTE + range.from * 60

// Horizontal slot of a block inside its day column, as fractions of the width.
export type BlockPlace = { left: number; width: number }

// Side-by-side columns for overlapping items of one day: items are clustered
// into runs that overlap transitively, each run is split into the fewest
// columns (first column whose last item ended), and an item stretches over the
// free columns to its right.
export const layoutDay = <T extends { key: string; startMin: number; endMin: number }>(
  items: readonly T[],
): Map<string, BlockPlace> => {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.key.localeCompare(b.key),
  )
  const out = new Map<string, BlockPlace>()
  let cluster: T[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const columns: T[][] = []
    const columnOf = new Map<string, number>()
    for (const it of cluster) {
      let placed = columns.findIndex(
        (col) => col[col.length - 1].endMin <= it.startMin,
      )
      if (placed === -1) {
        columns.push([it])
        placed = columns.length - 1
      } else {
        columns[placed].push(it)
      }
      columnOf.set(it.key, placed)
    }
    const n = columns.length
    for (const it of cluster) {
      const col = columnOf.get(it.key) ?? 0
      let span = 1
      for (let c = col + 1; c < n; c++) {
        const blocked = columns[c].some(
          (o) => o.startMin < it.endMin && it.startMin < o.endMin,
        )
        if (blocked) break
        span++
      }
      out.set(it.key, { left: col / n, width: span / n })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const it of sorted) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  flush()
  return out
}

// ---- conflicts ---------------------------------------------------------------------

export type ConflictCandidate = {
  key: string | null
  date: string
  startMin: number
  endMin: number
  gymId: string | null
  coachIds: readonly string[]
}

export type Conflict<T> = { reason: "gym" | "coach"; item: T }

export const findConflicts = <T extends ConflictCandidate>(
  candidate: ConflictCandidate,
  items: readonly T[],
): Conflict<T>[] => {
  const out: Conflict<T>[] = []
  for (const it of items) {
    if (candidate.key !== null && it.key === candidate.key) continue
    if (it.date !== candidate.date) continue
    if (!(it.startMin < candidate.endMin && candidate.startMin < it.endMin)) continue
    if (candidate.gymId && it.gymId === candidate.gymId) {
      out.push({ reason: "gym", item: it })
    } else if (candidate.coachIds.some((c) => it.coachIds.includes(c))) {
      out.push({ reason: "coach", item: it })
    }
  }
  return out
}

// ---- colors ------------------------------------------------------------------------

export const FALLBACK_COLOR = "#64748b"

// "#rrggbb" + alpha → "rgba(...)"; anything unparsable falls back to slate.
export const withAlpha = (hex: string | null | undefined, alpha: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "") ?? /^#?([0-9a-f]{6})$/i.exec(FALLBACK_COLOR)
  const n = parseInt((m as RegExpExecArray)[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
