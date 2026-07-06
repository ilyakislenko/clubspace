// Pure leaderboard math, split out so ranking + streak logic can be unit
// tested without a database.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Which ISO-agnostic "week bucket" a timestamp falls in. We only need buckets
// to be contiguous integers one week apart, not aligned to Monday — a streak
// is "attended something in N consecutive 7-day windows", which is what the
// gym cares about.
export const weekIndex = (d: Date): number => Math.floor(d.getTime() / WEEK_MS)

// Consecutive weeks (ending at the current or immediately-previous week) in
// which the member attended at least once. The one-week grace means a streak
// doesn't visibly break just because the current week isn't over yet.
export const computeStreakWeeks = (
    weekIndices: number[],
    currentWeek: number,
): number => {
    const weeks = new Set(weekIndices)
    let start: number
    if (weeks.has(currentWeek)) start = currentWeek
    else if (weeks.has(currentWeek - 1)) start = currentWeek - 1
    else return 0

    let streak = 0
    for (let w = start; weeks.has(w); w--) streak++
    return streak
}

export type RankableEntry = {
    userId: string
    name: string
    checkins: number
}

export type RankedEntry<T extends RankableEntry> = T & { rank: number }

// Competition ranking (1, 2, 2, 4): equal check-in counts share a rank, and
// the next rank skips accordingly. Ties are ordered by name for a stable,
// deterministic list. Callers pass only entries that should appear (already
// filtered for opt-out and checkins > 0).
export const rankEntries = <T extends RankableEntry>(
    entries: T[],
): RankedEntry<T>[] => {
    const sorted = [...entries].sort(
        (a, b) => b.checkins - a.checkins || a.name.localeCompare(b.name),
    )
    let lastCheckins: number | null = null
    let lastRank = 0
    return sorted.map((entry, index) => {
        const rank =
            entry.checkins === lastCheckins ? lastRank : index + 1
        lastCheckins = entry.checkins
        lastRank = rank
        return { ...entry, rank }
    })
}
