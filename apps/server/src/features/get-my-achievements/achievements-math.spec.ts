import {
    computeAchievements,
    longestStreakWeeks,
    MILESTONES,
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
        const a = computeAchievements([], now)
        expect(a.totalCheckIns).toBe(0)
        expect(a.currentStreakWeeks).toBe(0)
        expect(a.longestStreakWeeks).toBe(0)
        expect(a.nextMilestone).toBe(1)
        expect(a.milestones.every((m) => !m.unlocked)).toBe(true)
    })

    it('unlocks milestones up to the total and dates them', () => {
        const start = new Date('2026-01-05T10:00:00Z')
        const checkIns = weeklyFrom(start, 12) // 12 total
        const a = computeAchievements(checkIns, now)
        expect(a.totalCheckIns).toBe(12)
        const unlocked = a.milestones.filter((m) => m.unlocked).map((m) => m.threshold)
        expect(unlocked).toEqual([1, 10])
        // The 10th milestone was achieved on the 10th check-in.
        const tenth = a.milestones.find((m) => m.threshold === 10)!
        expect(tenth.achievedAt).toBe(checkIns[9].toISOString())
        // Next target is 25.
        expect(a.nextMilestone).toBe(25)
    })

    it('reports null nextMilestone once every milestone is unlocked', () => {
        const start = new Date('2020-01-01T10:00:00Z')
        const a = computeAchievements(
            weeklyFrom(start, MILESTONES[MILESTONES.length - 1]),
            now,
        )
        expect(a.nextMilestone).toBeNull()
        expect(a.milestones.every((m) => m.unlocked)).toBe(true)
    })
})
