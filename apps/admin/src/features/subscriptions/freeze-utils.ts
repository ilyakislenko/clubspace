// Pure helpers for the abonement-freeze UI. Freezes are whole calendar days
// ("YYYY-MM-DD", both ends inclusive); the server decides with the club's
// timezone, the panel compares with the browser's local "today" — close enough
// for a local club, and the server is the one that enforces.

export const FREEZE_DAY_PRESETS = [7, 14, 30]
export const FREEZE_REASON_PRESETS = ["Травма", "Болезнь", "Отпуск"]
export const MAX_FREEZE_DAYS = 90

const DAY_MS = 86_400_000

type FreezeRange = { fromDate: string; untilDate: string }

const ymdToUtc = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

const pad = (n: number): string => String(n).padStart(2, "0")

// The browser-local calendar day of `now`.
export const todayYmd = (now: Date): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export const addDaysYmd = (ymd: string, n: number): string =>
  new Date(ymdToUtc(ymd) + n * DAY_MS).toISOString().slice(0, 10)

const diffDaysYmd = (later: string, earlier: string): number =>
  Math.round((ymdToUtc(later) - ymdToUtc(earlier)) / DAY_MS)

export const freezePhase = (
  f: FreezeRange,
  today: string,
): "upcoming" | "current" | "past" => {
  if (today < f.fromDate) return "upcoming"
  if (today <= f.untilDate) return "current"
  return "past"
}

// The current or upcoming freeze of one abonement, earliest first.
export const openFreezeOf = <F extends FreezeRange & { subscriptionId: string }>(
  freezes: F[],
  subscriptionId: string,
  today: string,
): F | null => {
  const open = freezes
    .filter((f) => f.subscriptionId === subscriptionId && f.untilDate >= today)
    .sort((a, b) => (a.fromDate < b.fromDate ? -1 : 1))
  return open[0] ?? null
}

// Days the abonement shrinks by if the freeze is ended today. Mirrors the
// server: not started (or starting today) gives all days back; mid-freeze gives
// back today and everything after; a finished freeze gives nothing.
export const returnDaysIfEndedToday = (
  f: FreezeRange & { days: number },
  today: string,
): number => {
  if (today <= f.fromDate) return f.days
  if (today <= f.untilDate) return diffDaysYmd(f.untilDate, today) + 1
  return 0
}

export const totalFrozenDays = (
  freezes: { subscriptionId: string; days: number }[],
  subscriptionId: string,
): number =>
  freezes
    .filter((f) => f.subscriptionId === subscriptionId)
    .reduce((sum, f) => sum + f.days, 0)

const dayFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
})

// "30 октября" — rendered in UTC so the day never shifts with the browser zone.
export const formatDay = (ymd: string): string =>
  dayFmt.format(new Date(ymdToUtc(ymd)))

// "с 24 по 30 октября" within a month, "с 28 октября по 3 ноября" across months.
export const formatDayRange = (from: string, until: string): string =>
  from.slice(0, 7) === until.slice(0, 7)
    ? `с ${Number(from.slice(8, 10))} по ${formatDay(until)}`
    : `с ${formatDay(from)} по ${formatDay(until)}`

// The abonement end date after adding `days` freeze days (instant arithmetic,
// same as the server).
export const extendedEndDate = (endIso: string, days: number): Date =>
  new Date(new Date(endIso).getTime() + days * DAY_MS)

export const freezePhaseLabel = (
  f: FreezeRange & { endedEarlyAt: string | null },
  today: string,
): string => {
  const phase = freezePhase(f, today)
  if (phase === "upcoming") return "запланирована"
  if (phase === "current") return "идёт"
  return f.endedEarlyAt ? "завершена досрочно" : "завершена"
}
