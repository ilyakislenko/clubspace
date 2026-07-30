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

// Build the achievements view for a member: their check-in timestamps
// (ascending), the configured achievements, and the current time.
export const computeAchievements = (
    configs: AchievementConfig[],
    checkInsAsc: Date[],
    now: Date,
): Achievements => {
    const total = checkInsAsc.length
    const weekIndices = checkInsAsc.map(weekIndex)
    const longest = longestStreakWeeks(weekIndices)

    const achievements: ComputedAchievement[] = configs.map((c) => {
        const value = c.metric === 'streak' ? longest : total
        const unlocked = value >= c.threshold
        // Check-in achievements get dated to the threshold-th check-in.
        const achievedAt =
            unlocked && c.metric === 'checkins' && checkInsAsc[c.threshold - 1]
                ? checkInsAsc[c.threshold - 1].toISOString()
                : null
        return { ...c, unlocked, achievedAt }
    })

    const nextMilestone =
        configs
            .filter((c) => c.metric === 'checkins' && total < c.threshold)
            .map((c) => c.threshold)
            .sort((a, b) => a - b)[0] ?? null

    return {
        totalCheckIns: total,
        currentStreakWeeks: computeStreakWeeks(weekIndices, weekIndex(now)),
        longestStreakWeeks: longest,
        achievements,
        nextMilestone,
    }
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
    50: '🥋',
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
}))
