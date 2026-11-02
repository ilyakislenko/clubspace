import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import {
    achievementValue,
    checkInsByDirection,
    checkInSummary,
    computeAchievements,
    scopedCheckIns,
    countUnlockedBy,
    defaultAchievements,
    longestStreakWeeks,
    recentWeekCounts,
    type AchievementConfig,
} from './achievements-math'

const DEFAULT_ACHIEVEMENTS = defaultAchievements(vocabularyForWorkspaceType('GRAPPLING'))

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// n check-ins one week apart starting at `start`.
const weeklyFrom = (start: Date, n: number): Date[] =>
    Array.from({ length: n }, (_, i) => new Date(start.getTime() + i * WEEK_MS))

describe('defaultAchievements', () => {
    it('names the academy ladder «1 тренировка … 365 тренировок»', () => {
        expect(DEFAULT_ACHIEVEMENTS.map((a) => a.name)).toEqual([
            '1 тренировка',
            '10 тренировок',
            '25 тренировок',
            '50 тренировок',
            '100 тренировок',
            '200 тренировок',
            '365 тренировок',
        ])
    })

    it('names a dance or yoga studio ladder in «занятия»', () => {
        for (const type of ['DANCE', 'YOGA']) {
            expect(
                defaultAchievements(vocabularyForWorkspaceType(type)).map((a) => a.name),
            ).toEqual([
                '1 занятие',
                '10 занятий',
                '25 занятий',
                '50 занятий',
                '100 занятий',
                '200 занятий',
                '365 занятий',
            ])
        }
    })
})

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
                directionId: null,
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

describe('direction achievements', () => {
    const now = new Date('2026-07-20T12:00:00Z')
    const D = 'dir-1'
    const visits = [
        { markedAt: new Date('2026-06-01T10:00:00Z'), directionId: D },
        { markedAt: new Date('2026-06-08T10:00:00Z'), directionId: null },
        { markedAt: new Date('2026-06-15T10:00:00Z'), directionId: D },
        { markedAt: new Date('2026-06-22T10:00:00Z'), directionId: 'dir-2' },
    ]
    const cfg = (
        id: string,
        metric: 'checkins' | 'streak',
        threshold: number,
        directionId: string | null,
    ): AchievementConfig => ({
        id,
        name: id,
        description: null,
        icon: null,
        metric,
        threshold,
        directionId,
    })

    it('splits visits by direction, skipping direction-less ones', () => {
        const by = checkInsByDirection(visits)
        expect(by.get(D)).toHaveLength(2)
        expect(by.get('dir-2')).toHaveLength(1)
        expect(by.size).toBe(2)
    })

    it('judges a direction achievement on its own visits and keeps totals club-wide', () => {
        const by = checkInsByDirection(visits)
        const a = computeAchievements(
            [
                cfg('d2', 'checkins', 2, D),
                cfg('d3', 'checkins', 3, D),
                cfg('ds2', 'streak', 2, D),
                cfg('c5', 'checkins', 5, null),
                cfg('dir1', 'checkins', 1, 'dir-9'),
            ],
            visits.map((v) => v.markedAt),
            now,
            by,
        )
        const m = Object.fromEntries(a.achievements.map((x) => [x.id, x]))
        expect(m.d2.unlocked).toBe(true)
        expect(m.d2.achievedAt).toBe(visits[2].markedAt.toISOString())
        expect(m.d3.unlocked).toBe(false)
        // Direction visits are two weeks apart → no 2-week run.
        expect(m.ds2.unlocked).toBe(false)
        // A direction without visits counts nothing.
        expect(m.dir1.unlocked).toBe(false)
        expect(a.totalCheckIns).toBe(4)
        // Next milestone ignores direction ladders.
        expect(a.nextMilestone).toBe(5)
    })

    it('scopes values and summaries', () => {
        const by = checkInsByDirection(visits)
        const all = visits.map((v) => v.markedAt)
        expect(scopedCheckIns(cfg('c', 'checkins', 1, null), all, by)).toBe(all)
        expect(scopedCheckIns(cfg('d', 'checkins', 1, D), all, by)).toHaveLength(2)
        expect(achievementValue(cfg('s', 'streak', 1, null), all)).toBe(4)
        expect(checkInSummary(by.get(D)!, now)).toEqual({
            totalCheckIns: 2,
            currentStreakWeeks: 0,
            longestStreakWeeks: 1,
        })
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
