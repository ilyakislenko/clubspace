import type {
  ScheduleEvent,
  ScheduleSession,
  ScheduleSessionBooking,
  WorkspaceSchedule,
} from "../../shared/api/groups"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import { MONTHS_OF_RU } from "../../shared/format-ru"
import { addDaysYmd } from "../agenda/agenda-helpers"
import { DAY_SHORT } from "./schedule-helpers"

/**
 * Pure layout of the club schedule as a calendar: which day a class lands on
 * (in its own zone, split at midnight), where it sits on the time axis, how
 * overlapping classes share a day column, and how the days page by week.
 * Framework-free so jest covers it; `WeekCalendar` only draws the result.
 */

// From this window width the schedule is a week grid; below it, a day strip
// over one day's list.
export const CALENDAR_WIDE_MIN = 768
export const WEEK_DAYS = 7
// The schedule is fetched two weeks at a time; paging past a window fetches
// the next one.
export const FETCH_WINDOW_DAYS = 14
// How far ahead the calendar lets a member page: twelve weeks from today.
export const CALENDAR_HORIZON_DAYS = 84
export const CALENDAR_PAGES = CALENDAR_HORIZON_DAYS / WEEK_DAYS
// The axis when there is nothing to fit it to.
export const DEFAULT_AXIS: TimeAxis = { startHour: 8, endHour: 21 }
// A personal session without a confirmed length still gets an hour.
const DEFAULT_PERSONAL_MIN = 60
const DAY_MIN = 24 * 60

export type CalendarItem =
  | (CalendarTimes & { kind: "session"; session: ScheduleSession })
  | (CalendarTimes & { kind: "event"; event: ScheduleEvent })
  | (CalendarTimes & { kind: "personal"; personal: PersonalTraining })

type CalendarTimes = {
  key: string
  startAt: string
  endAt: string
  // The zone the item's wall clock is in (the gym's, else the club's).
  timezone: string
}

// Classes, events and the member's confirmed personal sessions as one list.
export const calendarItems = (
  schedule: WorkspaceSchedule,
  personal: readonly PersonalTraining[] = [],
): CalendarItem[] => [
  ...schedule.sessions.map(
    (s): CalendarItem => ({
      kind: "session",
      key: `s:${s.occurrenceId}`,
      startAt: s.startAt,
      endAt: s.endAt,
      timezone: s.timezone,
      session: s,
    }),
  ),
  ...schedule.events.map(
    (e): CalendarItem => ({
      kind: "event",
      key: `e:${e.id}`,
      startAt: e.startAt,
      endAt: e.endAt,
      timezone: e.timezone,
      event: e,
    }),
  ),
  ...personal.flatMap((pt): CalendarItem[] =>
    pt.confirmedStartAt
      ? [
          {
            kind: "personal",
            key: `p:${pt.id}`,
            startAt: pt.confirmedStartAt,
            endAt: new Date(
              new Date(pt.confirmedStartAt).getTime() +
                (pt.confirmedDurationMin ?? DEFAULT_PERSONAL_MIN) * 60_000,
            ).toISOString(),
            timezone: pt.timezone,
            personal: pt,
          },
        ]
      : [],
  ),
]

// An instant's calendar day and minute of the day in `timeZone`.
export const zonedDayMinute = (
  at: string | number | Date,
  timeZone: string,
): { dateKey: string; minute: number } => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(at))
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value
      return acc
    }, {})
  // Some engines still print midnight as «24» under h23.
  const hour = Number(parts.hour) % 24
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minute: hour * 60 + Number(parts.minute),
  }
}

// The club's «today» — the calendar starts on it.
export const todayKeyIn = (timeZone: string, now: number): string =>
  zonedDayMinute(now, timeZone).dateKey

// `count` consecutive day keys from `from`.
export const dayKeysFrom = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => addDaysYmd(from, i))

export type Segment = {
  item: CalendarItem
  dateKey: string
  // Minutes from the day's midnight, in the item's zone.
  startMin: number
  endMin: number
  // The item started the day before / goes on past midnight.
  continuesBefore: boolean
  continuesAfter: boolean
}

// An item longer than this is cut off (a month-long event is no grid block).
const MAX_SPAN_DAYS = 31

// One segment per calendar day the item covers in its own zone: a class from
// 23:00 to 01:00 is 23:00–24:00 on its day and 00:00–01:00 on the next.
export const splitByDay = (item: CalendarItem): Segment[] => {
  const start = zonedDayMinute(item.startAt, item.timezone)
  const endMs = Math.max(
    new Date(item.endAt).getTime(),
    new Date(item.startAt).getTime(),
  )
  const end = zonedDayMinute(endMs, item.timezone)
  // Ends exactly at midnight: the item's last day is the one before.
  const lastDay =
    end.minute === 0 && end.dateKey > start.dateKey
      ? addDaysYmd(end.dateKey, -1)
      : end.dateKey
  const segments: Segment[] = []
  let day = start.dateKey
  for (let i = 0; i < MAX_SPAN_DAYS && day <= lastDay; i++) {
    const first = day === start.dateKey
    const last = day === lastDay
    segments.push({
      item,
      dateKey: day,
      startMin: first ? start.minute : 0,
      endMin: !last ? DAY_MIN : lastDay === end.dateKey ? end.minute : DAY_MIN,
      continuesBefore: !first,
      continuesAfter: !last,
    })
    day = addDaysYmd(day, 1)
  }
  return segments
}

// The segments of each requested day, earliest first. Days outside `dayKeys`
// are dropped.
export const segmentsByDay = (
  items: readonly CalendarItem[],
  dayKeys: readonly string[],
): Map<string, Segment[]> => {
  const byDay = new Map<string, Segment[]>(dayKeys.map((k) => [k, []]))
  for (const item of items) {
    for (const seg of splitByDay(item)) byDay.get(seg.dateKey)?.push(seg)
  }
  for (const list of byDay.values()) {
    list.sort(
      (a, b) =>
        a.startMin - b.startMin ||
        b.endMin - a.endMin ||
        a.item.key.localeCompare(b.item.key),
    )
  }
  return byDay
}

export type PlacedSegment = Segment & {
  // The first of `columns` side-by-side slots the segment takes, and how many
  // slots it spans.
  column: number
  span: number
  columns: number
}

// A class shorter than this still claims this much of the column, so two
// back-to-back instants don't draw on top of each other.
const MIN_OVERLAP_MIN = 15

const overlapEnd = (s: Segment) =>
  Math.max(s.endMin, s.startMin + MIN_OVERLAP_MIN)

// Overlapping segments of one day sit side by side: each cluster of
// transitively overlapping segments is split into as many columns as it
// needs at its busiest, every segment in the first free column. A segment
// then widens to the right over the columns nothing it overlaps uses, so an
// evening class after a crowded slot isn't left a sliver.
export const placeOverlaps = (segments: readonly Segment[]): PlacedSegment[] => {
  const sorted = [...segments].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
  )
  const placed: PlacedSegment[] = []
  let cluster: PlacedSegment[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1
  const closeCluster = () => {
    const columns = columnEnds.length
    for (const p of cluster) {
      p.columns = columns
      const end = overlapEnd(p)
      const blocked = cluster
        .filter(
          (o) =>
            o.column > p.column &&
            o.startMin < end &&
            p.startMin < overlapEnd(o),
        )
        .map((o) => o.column)
      p.span = Math.min(columns, ...blocked) - p.column
    }
    cluster = []
    columnEnds = []
  }
  for (const seg of sorted) {
    const end = overlapEnd(seg)
    if (seg.startMin >= clusterEnd) closeCluster()
    let column = columnEnds.findIndex((e) => e <= seg.startMin)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(end)
    } else {
      columnEnds[column] = end
    }
    clusterEnd = cluster.length === 0 ? end : Math.max(clusterEnd, end)
    const p: PlacedSegment = { ...seg, column, span: 1, columns: 1 }
    cluster.push(p)
    placed.push(p)
  }
  closeCluster()
  return placed
}

export type TimeAxis = { startHour: number; endHour: number }

// The hours the grid spans: from the earliest start to the latest end of the
// given segments, on whole hours. A segment's midnight cut doesn't stretch
// the axis to 00:00/24:00 — it keeps an hour beside its real edge and is
// clipped to the axis when drawn.
export const fitTimeAxis = (
  segments: Iterable<Segment>,
  fallback: TimeAxis = DEFAULT_AXIS,
): TimeAxis => {
  let min = Infinity
  let max = -Infinity
  for (const s of segments) {
    min = Math.min(min, s.continuesBefore ? Math.max(0, s.endMin - 60) : s.startMin)
    max = Math.max(
      max,
      s.continuesAfter ? Math.min(DAY_MIN, s.startMin + 60) : s.endMin,
    )
  }
  if (min === Infinity) return fallback
  const startHour = Math.floor(min / 60)
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(max / 60)))
  return { startHour, endHour }
}

// A segment's vertical frame on a grid of `hourHeight` px per hour, clipped
// to the axis and at least `minHeight` tall.
export const blockFrame = (
  seg: { startMin: number; endMin: number },
  axis: TimeAxis,
  hourHeight: number,
  minHeight = 18,
): { top: number; height: number } => {
  const from = axis.startHour * 60
  const to = axis.endHour * 60
  const start = Math.min(Math.max(seg.startMin, from), to)
  const end = Math.min(Math.max(seg.endMin, start), to)
  const top = ((start - from) / 60) * hourHeight
  const total = ((to - from) / 60) * hourHeight
  const height = Math.max(minHeight, ((end - start) / 60) * hourHeight)
  // Keep a minimum-height block inside the grid at the bottom edge.
  return { top: Math.max(0, Math.min(top, total - height)), height }
}

// Where the «сейчас» line sits, or null outside the axis.
export const nowOffset = (
  minute: number,
  axis: TimeAxis,
  hourHeight: number,
): number | null =>
  minute < axis.startHour * 60 || minute > axis.endHour * 60
    ? null
    : ((minute - axis.startHour * 60) / 60) * hourHeight

// --- paging ---------------------------------------------------------------

// The week page a day (days from today) is on, and the day a page starts on.
export const pageOfDay = (dayOffset: number): number =>
  Math.floor(dayOffset / WEEK_DAYS)
export const firstDayOfPage = (page: number): number => page * WEEK_DAYS

// The two-week fetch window a day falls in.
export const fetchWindowOf = (dayOffset: number): number =>
  Math.floor(dayOffset / FETCH_WINDOW_DAYS)

// The dates to ask the server for: the window padded by a day on each side so
// a device zone ahead of or behind the club's can't slice off its edges.
export const fetchRange = (
  deviceToday: string,
  window: number,
): { from: string; to: string } => {
  const first = window * FETCH_WINDOW_DAYS
  return {
    from: addDaysYmd(deviceToday, first - 1),
    to: addDaysYmd(deviceToday, first + FETCH_WINDOW_DAYS + 1),
  }
}

// The day keys a fetch window covers, in the club's calendar.
export const windowDayKeys = (clubToday: string, window: number): string[] =>
  dayKeysFrom(addDaysYmd(clubToday, window * FETCH_WINDOW_DAYS), FETCH_WINDOW_DAYS)

const ymdParts = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number)
  return { y: y!, m: m!, d: d! }
}

// «Пн», «Вт», … for a day key.
export const weekdayShort = (ymd: string): string => {
  const { y, m, d } = ymdParts(ymd)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return DAY_SHORT[js === 0 ? 7 : js]!
}

export const dayOfMonth = (ymd: string): number => ymdParts(ymd).d

// «2 ноября».
export const formatDayLong = (ymd: string): string => {
  const { m, d } = ymdParts(ymd)
  return `${d} ${MONTHS_OF_RU[m - 1]}`
}

// The page's title: «2 – 8 ноября», «30 ноября – 6 декабря».
export const formatWeekRange = (first: string, last: string): string => {
  const a = ymdParts(first)
  const b = ymdParts(last)
  return a.m === b.m && a.y === b.y
    ? `${a.d} – ${b.d} ${MONTHS_OF_RU[b.m - 1]}`
    : `${formatDayLong(first)} – ${formatDayLong(last)}`
}

// --- block content --------------------------------------------------------

export type BlockTone = "mine" | "full" | "normal" | "cancelled"

// The class's booking state as one short line: the member's own place first,
// then the places. Null when there is nothing to say (a fixed group's class).
export const blockStateLine = (
  s: { cancelled: boolean; booking?: ScheduleSessionBooking | null },
  guestBooked: boolean,
): { text: string; tone: BlockTone } | null => {
  if (s.cancelled) return { text: "Отменено", tone: "cancelled" }
  const b = s.booking ?? null
  if (guestBooked || (b?.myBookingId && b.myStatus === "BOOKED")) {
    return { text: "Вы записаны", tone: "mine" }
  }
  if (b?.myBookingId && b.myStatus === "WAITLISTED") {
    return {
      text: b.myWaitlistPosition
        ? `лист ожидания №${b.myWaitlistPosition}`
        : "лист ожидания",
      tone: "mine",
    }
  }
  if (!b) return null
  if (b.capacity === null) {
    return b.booked > 0 ? { text: `записано ${b.booked}`, tone: "normal" } : null
  }
  if (b.booked >= b.capacity) {
    return {
      text: b.waitlist > 0 ? `Мест нет · очередь ${b.waitlist}` : "Мест нет",
      tone: "full",
    }
  }
  return { text: `${b.booked}/${b.capacity}`, tone: "normal" }
}

// «Роман Савельев»; the email when the person has no name.
export const personName = (p: {
  firstname: string | null
  lastname: string | null
  email: string | null
}): string =>
  [p.firstname, p.lastname].filter(Boolean).join(" ").trim() ||
  p.email ||
  "Тренер"

// «Р. Савельев»; the email when the coach has no name.
export const shortPersonName = (p: {
  firstname: string | null
  lastname: string | null
  email: string | null
}): string => {
  const first = p.firstname?.trim()
  const last = p.lastname?.trim()
  if (first && last) return `${first.charAt(0)}. ${last}`
  return first || last || p.email || "Тренер"
}

/**
 * How much a week-grid block can say at its width (dp):
 * - "full": «12:00–13:30», the title and whatever else fits;
 * - "brief": the start time instead of the range;
 * - "narrow": the start and a one-line title (a phone's whole day column);
 * - "time": the start alone — a title cut to one letter says nothing;
 * - "bare": no text, just the coloured block. A phone's day column split
 *   between overlapping classes leaves ~20 dp, where any text came out as
 *   «0…» / «1…».
 * The block's spoken label and its tap (the class details) carry everything.
 */
export type BlockDetail = "full" | "brief" | "narrow" | "time" | "bare"

export const blockDetail = (width: number): BlockDetail =>
  width < 36
    ? "bare"
    : width < 40
      ? "time"
      : width < 72
        ? "narrow"
        : width < 120
          ? "brief"
          : "full"

// Keeps the `max` most important lines (lower `priority` wins) in their
// original order — what fits in a short block.
export const fitLines = <T extends { priority: number }>(
  lines: readonly T[],
  max: number,
): T[] => {
  if (lines.length <= max) return [...lines]
  const keep = new Set(
    [...lines]
      .map((l, i) => ({ l, i }))
      .sort((a, b) => a.l.priority - b.l.priority || a.i - b.i)
      .slice(0, Math.max(0, max))
      .map(({ i }) => i),
  )
  return lines.filter((_, i) => keep.has(i))
}

// A club color as a translucent fill: «#3b82f6» → «rgba(59, 130, 246, 0.16)».
// Null for anything but #rgb / #rrggbb, so the caller falls back to a theme
// token.
export const tintColor = (
  color: string | null | undefined,
  alpha: number,
): string | null => {
  const m = color?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const hex =
    m[1]!.length === 3
      ? m[1]!
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1]!
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
