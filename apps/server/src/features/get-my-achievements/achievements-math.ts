// Pure achievements math (attendance milestones + streaks), split out so it can
// be unit tested without a database. Streak week-bucketing is shared with the
// leaderboard so "streak" means the same thing everywhere.
import {
    computeStreakWeeks,
    weekIndex,
} from '../attendance-leaderboard/leaderboard-math'

// Cumulative check-in milestones. Sport-agnostic (just a count of attendances),
// so this works for any discipline. Ascending.
export const MILESTONES = [1, 10, 25, 50, 100, 200, 365] as const

export type Milestone = {
    threshold: number
    unlocked: boolean
    // ISO timestamp of the check-in that reached this count; null until reached.
    achievedAt: string | null
}

export type Achievements = {
    totalCheckIns: number
    currentStreakWeeks: number
    longestStreakWeeks: number
    milestones: Milestone[]
    // Next threshold not yet reached, or null once all are unlocked.
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

// Build the achievements view from a member's check-in timestamps (ascending)
// and the current time.
export const computeAchievements = (
    checkInsAsc: Date[],
    now: Date,
): Achievements => {
    const total = checkInsAsc.length
    const weekIndices = checkInsAsc.map(weekIndex)

    const milestones: Milestone[] = MILESTONES.map((threshold) => ({
        threshold,
        unlocked: total >= threshold,
        // The count hit `threshold` on the threshold-th check-in (1-indexed).
        achievedAt:
            total >= threshold
                ? checkInsAsc[threshold - 1].toISOString()
                : null,
    }))

    return {
        totalCheckIns: total,
        currentStreakWeeks: computeStreakWeeks(weekIndices, weekIndex(now)),
        longestStreakWeeks: longestStreakWeeks(weekIndices),
        milestones,
        nextMilestone: MILESTONES.find((m) => total < m) ?? null,
    }
}
