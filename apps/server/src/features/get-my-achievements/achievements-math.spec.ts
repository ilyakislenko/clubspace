import {
    computeAchievements,
    countUnlockedBy,
    DEFAULT_ACHIEVEMENTS,
    longestStreakWeeks,
    recentWeekCounts,
    type AchievementConfig,
} from './achievements-math'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// n check-ins one week apart starting at `start`.
const weeklyFrom = (start: Date, n: number): Date[] =>
    Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * WEEK_MS))

describe('longestStreakWeeks', () => {
    it('is 0 with no check-ins', () => {
        expect(longestStreakWeeks([])).toBe(0)
    })

    it('counts the longest consecutive run, ignoring gaps + duplicates', () => {
        // weeks 1,2,3 (run 3), gap, 5, gap, 8,9 (run 2)
        expect(longestStreakWeeks([1, 2, 2, 3, 5, 8, 9])).toBe(3)
    })
})

describe('computeAchievements', () => {
    const now = new Date('2026-07-20T12:00:00Z')

    it('is all-zero / locked for a member who never trained', () => {
        const a = computeAchievements(DEFAULT_ACHIEVEMENTS, [], now)
        expect(a.totalCheckIns).toBe(0)
        expect(a.currentStreakWeeks).toBe(0)
        expect(a.longestStreakWeeks).toBe(0)
        expect(a.nextMilestone).toBe(1)
        expect(a.achievements.every((m) => !m.unlocked)).toBe(true)
    })

    it('unlocks check-in achievements up to the total and dates them', () => {
        const start = new Date('2026-01-05T10:00:00Z')
        const checkIns = weeklyFrom(start, 12) // 12 total
        const a = computeAchievements(DEFAULT_ACHIEVEMENTS, checkIns, now)
        expect(a.totalCheckIns).toBe(12)
        const unlocked = a.achievements
            .filter((m) => m.unlocked)
            .map((m) => m.threshold)
        expect(unlocked).toEqual([1, 10])
        const tenth = a.achievements.find((m) => m.threshold === 10)!
        expect(tenth.achievedAt).toBe(checkIns[9].toISOString())
        expect(a.nextMilestone).toBe(25)
    })

    it('unlocks a streak achievement by longest streak, not check-in count', () => {
        const configs: AchievementConfig[] = [
            {
                id: 's3',
                name: '3 недели подряд',
                description: null,
                icon: '🔥',
                metric: 'streak',
                threshold: 3,
            },
        ]
        // 3 consecutive weekly check-ins → longest streak 3.
        const a = computeAchievements(
            configs,
            weeklyFrom(new Date('2026-06-01T10:00:00Z'), 3),
            now,
        )
        expect(a.longestStreakWeeks).toBe(3)
        expect(a.achievements[0].unlocked).toBe(true)
        // Streak achievements aren't dated.
        expect(a.achievements[0].achievedAt).toBeNull()
    })

    it('counts how many members unlocked each achievement', () => {
        const configs = [
            { id: 'c10', metric: 'checkins' as const, threshold: 10 },
            { id: 'c50', metric: 'checkins' as const, threshold: 50 },
            { id: 's4', metric: 'streak' as const, threshold: 4 },
        ]
        const members = [
            { total: 60, longest: 5 }, // c10, c50, s4
            { total: 12, longest: 2 }, // c10
            { total: 3, longest: 1 }, // none
        ]
        expect(countUnlockedBy(configs, members)).toEqual({
            c10: 2,
            c50: 1,
            s4: 1,
        })
    })

    it('reports null nextMilestone once every check-in achievement is unlocked', () => {
        const a = computeAchievements(
            DEFAULT_ACHIEVEMENTS,
            weeklyFrom(new Date('2020-01-01T10:00:00Z'), 400),
            now,
        )
        expect(a.nextMilestone).toBeNull()
        expect(a.achievements.every((m) => m.unlocked)).toBe(true)
    })
})

describe('recentWeekCounts', () => {
    it('is 12 zeros with no check-ins', () => {
        expect(recentWeekCounts([], 100)).toEqual(new Array(12).fill(0))
    })

    it('counts check-ins in the current bucket into the last slot', () => {
        const counts = recentWeekCounts([100, 100], 100)
        expect(counts[11]).toBe(2)
        expect(counts.slice(0, 11).every((c) => c === 0)).toBe(true)
    })

    it('puts a check-in 11 buckets ago in slot 0', () => {
        expect(recentWeekCounts([89], 100)[0]).toBe(1)
    })

    it('drops a check-in 12 buckets ago', () => {
        expect(recentWeekCounts([88], 100)).toEqual(new Array(12).fill(0))
    })

    it('is included in computeAchievements with length 12', () => {
        const a = computeAchievements(
            DEFAULT_ACHIEVEMENTS,
            [new Date('2026-07-20T10:00:00Z')],
            new Date('2026-07-20T12:00:00Z'),
        )
        expect(a.recentWeeks).toHaveLength(12)
        expect(a.recentWeeks[11]).toBe(1)
    })
})
