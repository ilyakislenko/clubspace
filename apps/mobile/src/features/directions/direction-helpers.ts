import type {
  Achievement,
  AchievementDirection,
  Achievements,
} from "../../shared/api/achievements"
import type { DirectionRef } from "../../shared/api/directions"

/**
 * The picked direction, or `null` («Все») when nothing is picked or the
 * picked one has left the list (archived, or another club's).
 */
export const resolveDirectionFilter = (
  selectedId: string | null,
  directions: readonly { id: string }[],
): string | null =>
  selectedId && directions.some((d) => d.id === selectedId) ? selectedId : null

/**
 * The distinct directions tagged on a cross-club list (the agenda), in first
 * appearance order. Rows cached before directions existed have none.
 */
export const directionsOf = (
  rows: readonly { direction?: DirectionRef | null }[],
): DirectionRef[] => {
  const seen = new Map<string, DirectionRef>()
  for (const row of rows) {
    if (row.direction && !seen.has(row.direction.id)) {
      seen.set(row.direction.id, row.direction)
    }
  }
  return [...seen.values()]
}

/** Keep only the rows of one direction; `null` keeps everything. */
export const filterByDirection = <T extends { direction?: DirectionRef | null }>(
  rows: readonly T[],
  directionId: string | null,
): T[] =>
  directionId
    ? rows.filter((row) => row.direction?.id === directionId)
    : [...rows]

export type AchievementSection = {
  key: string
  // null = the club-wide «Общие» section.
  direction: AchievementDirection | null
  achievements: Achievement[]
  totalCheckIns: number
  longestStreakWeeks: number
  currentStreakWeeks: number
  // The check-in threshold the member is working towards in this section.
  nextMilestone: number | null
}

const nextCheckinMilestone = (
  achievements: readonly Achievement[],
  totalCheckIns: number,
): number | null => {
  const ahead = achievements
    .filter((a) => a.metric === "checkins" && a.threshold > totalCheckIns)
    .map((a) => a.threshold)
  return ahead.length > 0 ? Math.min(...ahead) : null
}

/**
 * Splits the badges into «Общие» (club-wide) + one section per direction,
 * each counted against its own totals. `null` when the member has no
 * directions — the screen then renders the single flat list as before.
 * Sections without badges are dropped.
 */
export const achievementSections = (
  data: Achievements,
): AchievementSection[] | null => {
  // Optional at runtime: cached payloads predate directions.
  const directions = data.directions ?? []
  if (directions.length === 0) return null
  const general: AchievementSection = {
    key: "general",
    direction: null,
    achievements: data.achievements.filter((a) => !a.directionId),
    totalCheckIns: data.totalCheckIns,
    longestStreakWeeks: data.longestStreakWeeks,
    currentStreakWeeks: data.currentStreakWeeks,
    nextMilestone: data.nextMilestone,
  }
  const perDirection = directions.map((d): AchievementSection => {
    const achievements = data.achievements.filter((a) => a.directionId === d.id)
    return {
      key: d.id,
      direction: d,
      achievements,
      totalCheckIns: d.totalCheckIns,
      longestStreakWeeks: d.longestStreakWeeks,
      currentStreakWeeks: d.currentStreakWeeks,
      nextMilestone: nextCheckinMilestone(achievements, d.totalCheckIns),
    }
  })
  return [general, ...perDirection].filter((s) => s.achievements.length > 0)
}
