// Pure achievements math. Achievements are now club-configurable (see the
// Achievement model + manage-achievements); this computes unlock state for a
// given config list against a member's attendance. Streak week-bucketing is
// shared with the leaderboard so "streak" means the same thing everywhere.
import {
    computeStreakWeeks,
    weekIndex,
} from '../attendance-leaderboard/leaderboard-math'

export type AchievementMetricKey = 'checkins' | 'streak'

// One achievement's config (from the DB, or a built-in default).
export type AchievementConfig = {
    id: string
    name: string
    description: string | null
    icon: string | null
    metric: AchievementMetricKey
    threshold: number
    // null = club-wide (every visit counts); otherwise only visits in sessions
    // of this direction count towards it.
    directionId: string | null
}

export type ComputedAchievement = AchievementConfig & {
    unlocked: boolean
    // ISO timestamp it was reached (checkins only); null if locked or streak.
    achievedAt: string | null
}

export type Achievements = {
    totalCheckIns: number
    currentStreakWeeks: number
    longestStreakWeeks: number
    achievements: ComputedAchievement[]
    // Next unreached check-in threshold, for the "progress to next" hero.
    nextMilestone: number | null
    // Check-ins per week-bucket, last 12 weeks, oldest first (last = current).
    recentWeeks: number[]
}

// Check-ins per week-bucket for the last `n` buckets, oldest first; the
// last entry is the current bucket. Same bucketing as the streak.
export const recentWeekCounts = (
    weekIndices: number[],
    currentWeek: number,
    n = 12,
): number[] => {
    const counts = new Array<number>(n).fill(0)
    for (const w of weekIndices) {
        const slot = n - 1 - (currentWeek - w)
        if (slot >= 0 && slot < n) counts[slot]++
    }
    return counts
}

// Longest run of consecutive week-buckets that each contain ≥1 check-in.
export const longestStreakWeeks = (weekIndices: number[]): number => {
    const weeks = [...new Set(weekIndices)].sort((a, b) => a - b)
    if (weeks.length === 0) return 0
    let best = 1
    let run = 1
    for (let i = 1; i < weeks.length; i++) {
        run = weeks[i] === weeks[i - 1] + 1 ? run + 1 : 1
        if (run > best) best = run
    }
    return best
}

// Check-in timestamps (ascending) per direction, keyed by direction id.
export type DirectionCheckIns = ReadonlyMap<string, Date[]>

// Split a member's ascending visits by the direction of their session; visits
// in sessions without a direction belong to no direction.
export const checkInsByDirection = (
    visitsAsc: { markedAt: Date; directionId: string | null }[],
): Map<string, Date[]> => {
    const out = new Map<string, Date[]>()
    for (const v of visitsAsc) {
        if (!v.directionId) continue
        const arr = out.get(v.directionId)
        if (arr) arr.push(v.markedAt)
        else out.set(v.directionId, [v.markedAt])
    }
    return out
}

// The visits an achievement counts: all of them for a club-wide one, only its
// direction's for a direction one.
export const scopedCheckIns = (
    c: Pick<AchievementConfig, 'directionId'>,
    checkInsAsc: Date[],
    byDirection: DirectionCheckIns,
): Date[] =>
    c.directionId === null
        ? checkInsAsc
        : (byDirection.get(c.directionId) ?? [])

// Total / current / longest streak over one set of visits.
export const checkInSummary = (checkInsAsc: Date[], now: Date) => {
    const weekIndices = checkInsAsc.map(weekIndex)
    return {
        totalCheckIns: checkInsAsc.length,
        currentStreakWeeks: computeStreakWeeks(weekIndices, weekIndex(now)),
        longestStreakWeeks: longestStreakWeeks(weekIndices),
    }
}

// An achievement's current value over the visits it counts.
export const achievementValue = (
    c: Pick<AchievementConfig, 'metric'>,
    scopedAsc: Date[],
): number =>
    c.metric === 'streak'
        ? longestStreakWeeks(scopedAsc.map(weekIndex))
        : scopedAsc.length

// Build the achievements view for a member: their check-in timestamps
// (ascending), the configured achievements, and the current time. The totals,
// streaks, weekly bars and next milestone are club-wide; a direction
// achievement is judged on that direction's visits (`byDirection`) only.
export const computeAchievements = (
    configs: AchievementConfig[],
    checkInsAsc: Date[],
    now: Date,
    byDirection: DirectionCheckIns = new Map(),
): Achievements => {
    const total = checkInsAsc.length
    const weekIndices = checkInsAsc.map(weekIndex)
    const longest = longestStreakWeeks(weekIndices)
    const currentWeek = weekIndex(now)

    const achievements: ComputedAchievement[] = configs.map((c) => {
        const scoped = scopedCheckIns(c, checkInsAsc, byDirection)
        const value =
            c.directionId === null
                ? c.metric === 'streak'
                    ? longest
                    : total
                : achievementValue(c, scoped)
        const unlocked = value >= c.threshold
        // Check-in achievements get dated to the threshold-th counted check-in.
        const achievedAt =
            unlocked && c.metric === 'checkins' && scoped[c.threshold - 1]
                ? scoped[c.threshold - 1].toISOString()
                : null
        return { ...c, unlocked, achievedAt }
    })

    const nextMilestone =
        configs
            .filter(
                (c) =>
                    c.directionId === null &&
                    c.metric === 'checkins' &&
                    total < c.threshold,
            )
            .map((c) => c.threshold)
            .sort((a, b) => a - b)[0] ?? null

    return {
        totalCheckIns: total,
        currentStreakWeeks: computeStreakWeeks(weekIndices, currentWeek),
        longestStreakWeeks: longest,
        achievements,
        nextMilestone,
        recentWeeks: recentWeekCounts(weekIndices, currentWeek),
    }
}

export type MemberMetric = { total: number; longest: number }

// How many members have unlocked each achievement, by comparing its metric to
// each member's totals. Pure — the caller supplies the per-member figures.
export const countUnlockedBy = (
    configs: Pick<AchievementConfig, 'id' | 'metric' | 'threshold'>[],
    members: MemberMetric[],
): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const c of configs) {
        counts[c.id] = members.filter(
            (m) =>
                (c.metric === 'streak' ? m.longest : m.total) >= c.threshold,
        ).length
    }
    return counts
}

const plural = (n: number, one: string, few: string, many: string): string => {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return one
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
    return many
}

const DEFAULT_ICON: Record<number, string> = {
    1: '👟',
    10: '🔥',
    25: '💪',
    50: '⭐',
    100: '🏅',
    200: '🏆',
    365: '👑',
}

// The built-in ladder used when a club hasn't configured its own achievements,
// so existing workspaces keep working unchanged.
export const DEFAULT_ACHIEVEMENTS: AchievementConfig[] = [
    1, 10, 25, 50, 100, 200, 365,
].map((t) => ({
    id: `default-${t}`,
    name: `${t} ${plural(t, 'тренировка', 'тренировки', 'тренировок')}`,
    description: null,
    icon: DEFAULT_ICON[t] ?? null,
    metric: 'checkins' as const,
    threshold: t,
    directionId: null,
}))
