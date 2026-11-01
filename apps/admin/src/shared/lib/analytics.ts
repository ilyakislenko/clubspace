import type {
  AnalyticsScope,
  ChurnRiskLevel,
  ChurnRiskMember,
  CoachStats,
  CohortCell,
  CohortRow,
  OccupancyHeatmapCell,
} from "../api/analytics"

// Radix Select can't carry an empty value — "all" stands for "no filter"
// (the same value `DirectionFilter` uses for «Все направления»).
export const ANALYTICS_ALL = "all"

export type AnalyticsFilter = {
  gymId: string
  directionId: string
  groupId: string
  coachId: string
}

export const EMPTY_ANALYTICS_FILTER: AnalyticsFilter = {
  gymId: ANALYTICS_ALL,
  directionId: ANALYTICS_ALL,
  groupId: ANALYTICS_ALL,
  coachId: ANALYTICS_ALL,
}

const picked = (v: string): string | undefined =>
  v === ANALYTICS_ALL ? undefined : v

export const analyticsScope = (f: AnalyticsFilter): AnalyticsScope => ({
  gymId: picked(f.gymId),
  directionId: picked(f.directionId),
  groupId: picked(f.groupId),
  coachId: picked(f.coachId),
})

type Person = {
  firstname: string | null
  lastname: string | null
  email: string | null
}

export const personName = (p: Person): string =>
  [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || "—"

type GroupLike = {
  id: string
  gym: { id: string } | null
  direction: { id: string } | null
  coach: Person & { id: string }
  coaches: (Person & { userId: string })[]
}

// Coaches of the listed groups (primary + assistants), once each, by name.
export const analyticsCoachOptions = (
  groups: readonly GroupLike[],
): { id: string; name: string }[] => {
  const byId = new Map<string, string>()
  for (const g of groups) {
    byId.set(g.coach.id, personName(g.coach))
    for (const c of g.coaches) byId.set(c.userId, personName(c))
  }
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
}

// Groups that fit the other three filters, for the group picker.
export const analyticsGroupOptions = <T extends GroupLike>(
  groups: readonly T[],
  f: AnalyticsFilter,
): T[] =>
  groups.filter(
    (g) =>
      (f.gymId === ANALYTICS_ALL || g.gym?.id === f.gymId) &&
      (f.directionId === ANALYTICS_ALL || g.direction?.id === f.directionId) &&
      (f.coachId === ANALYTICS_ALL ||
        g.coach.id === f.coachId ||
        g.coaches.some((c) => c.userId === f.coachId)),
  )

// 0.734 → «73%», null → «—».
export const formatPercent = (rate: number | null): string =>
  rate === null ? "—" : `${Math.round(rate * 100)}%`

const decimalFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 })

// Average attendance: one decimal, Russian comma. null → «—».
export const formatAverage = (n: number | null): string =>
  n === null ? "—" : decimalFmt.format(n)

export const CHURN_LEVEL_LABEL: Record<ChurnRiskLevel, string> = {
  high: "Высокий риск",
  medium: "Средний риск",
  low: "Низкий риск",
}

export const CHURN_LEVEL_CHIP: Record<ChurnRiskLevel, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-muted text-foreground",
}

// «Кому позвонить» keeps the server order; members someone already called
// recently drop into a separate, collapsed list at the bottom.
export const splitChurnList = (
  data: readonly ChurnRiskMember[],
): { toCall: ChurnRiskMember[]; contacted: ChurnRiskMember[] } => ({
  toCall: data.filter((m) => !m.contactedRecently),
  contacted: data.filter((m) => m.contactedRecently),
})

export const COHORT_OFFSETS = [1, 2, 3, 6] as const

export const cohortCell = (
  row: CohortRow,
  offset: number,
): CohortCell | undefined => row.cells.find((c) => c.offset === offset)

const MONTHS = [
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

// "2026-07" → «Июль 2026».
export const formatCohortMonth = (key: string): string => {
  const [year, month] = key.split("-").map(Number)
  const name = MONTHS[month - 1]
  return name ? `${name} ${year}` : key
}

// Retention cell background: the higher the rate, the denser the colour.
export const rateCellClass = (rate: number | null): string => {
  if (rate === null) return ""
  if (rate >= 0.8) return "bg-primary/70 text-primary-foreground"
  if (rate >= 0.6) return "bg-primary/50"
  if (rate >= 0.4) return "bg-primary/35"
  if (rate >= 0.2) return "bg-primary/20"
  return "bg-primary/10"
}

// Slot fill: red when the room is mostly empty, green when it is full,
// darker green when more people come than the roster holds.
export const fillCellClass = (fill: number | null): string => {
  if (fill === null) return "bg-muted"
  if (fill > 1) return "bg-emerald-600/70 text-white"
  if (fill >= 0.7) return "bg-emerald-500/40"
  if (fill >= 0.4) return "bg-amber-500/30"
  return "bg-destructive/25"
}

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export const WEEKDAY_SHORT: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
}

// Heatmap rows: every hour from the earliest to the latest class (gaps kept,
// so an empty lunch hour reads as empty), plus a day/hour lookup.
export const heatmapGrid = (
  cells: readonly OccupancyHeatmapCell[],
): {
  hours: number[]
  at: (dayOfWeek: number, hour: number) => OccupancyHeatmapCell | undefined
} => {
  const byKey = new Map(cells.map((c) => [`${c.dayOfWeek}:${c.hour}`, c]))
  if (cells.length === 0) return { hours: [], at: () => undefined }
  const min = Math.min(...cells.map((c) => c.hour))
  const max = Math.max(...cells.map((c) => c.hour))
  const hours = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  return { hours, at: (d, h) => byKey.get(`${d}:${h}`) }
}

// «Пн 18:00 · Взрослые · Центр».
export const slotLabel = (s: {
  dayOfWeek: number
  startTime: string
  groupName: string
  gymName: string | null
}): string =>
  [
    `${WEEKDAY_SHORT[s.dayOfWeek] ?? ""} ${s.startTime}`.trim(),
    s.groupName,
    s.gymName,
  ]
    .filter(Boolean)
    .join(" · ")

// A 100% retention over one student says nothing — the best coach is picked
// among those with at least this many students to judge by.
export const MIN_COACH_SAMPLE = 3

export const bestRetentionCoachId = (
  coaches: readonly CoachStats[],
): string | null => {
  let best: CoachStats | null = null
  for (const c of coaches) {
    const rate = c.retention.rate
    if (rate === null || c.retention.eligible < MIN_COACH_SAMPLE) continue
    const bestRate = best?.retention.rate ?? -1
    if (
      rate > bestRate ||
      (rate === bestRate && c.retention.eligible > (best?.retention.eligible ?? 0))
    )
      best = c
  }
  return best?.coachId ?? null
}
