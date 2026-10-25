import {
    currentLevelRun,
    describeRemaining,
    evaluateReadiness,
    nextLevelAfter,
} from './rank-readiness'

const d = (s: string) => new Date(`${s}T00:00:00Z`)

describe('currentLevelRun', () => {
    it('returns null for no promotions', () => {
        expect(currentLevelRun([])).toBeNull()
    })

    it('keeps the level start across stripe promotions', () => {
        const run = currentLevelRun([
            { levelId: 'blue', stripes: 2, awardedAt: d('2026-09-01') },
            { levelId: 'blue', stripes: 1, awardedAt: d('2026-06-01') },
            { levelId: 'blue', stripes: 0, awardedAt: d('2026-03-01') },
            { levelId: 'white', stripes: 4, awardedAt: d('2025-01-01') },
        ])
        expect(run).toEqual({
            levelId: 'blue',
            stripes: 2,
            reachedAt: d('2026-03-01'),
        })
    })

    it('resets on a level change', () => {
        const run = currentLevelRun([
            { levelId: 'blue', stripes: 0, awardedAt: d('2026-03-01') },
            { levelId: 'white', stripes: 4, awardedAt: d('2025-01-01') },
        ])
        expect(run?.reachedAt).toEqual(d('2026-03-01'))
    })
})

describe('nextLevelAfter', () => {
    const levels = [
        { id: 'w', order: 0, isActive: true },
        { id: 'b', order: 1, isActive: false },
        { id: 'p', order: 2, isActive: true },
    ]
    it('skips archived levels', () => {
        expect(nextLevelAfter(levels, 'w')?.id).toBe('p')
    })
    it('returns null at the top', () => {
        expect(nextLevelAfter(levels, 'p')).toBeNull()
    })
    it('returns null for an unknown level', () => {
        expect(nextLevelAfter(levels, 'zzz')).toBeNull()
    })
})

describe('evaluateReadiness', () => {
    const reachedAt = d('2026-01-01')
    const weeks = (n: number) => new Date(reachedAt.getTime() + n * 7 * 86400000)

    it('has no rule when both limits are null', () => {
        const r = evaluateReadiness({
            nextLevel: { minVisits: null, minWeeks: null },
            reachedAt,
            visitsSince: 100,
            now: weeks(100),
        })
        expect(r).toMatchObject({ rule: null, ready: false, remainingText: null })
    })

    it('treats undefined limits as no rule', () => {
        expect(
            evaluateReadiness({
                nextLevel: {},
                reachedAt,
                visitsSince: 0,
                now: weeks(1),
            }).rule,
        ).toBeNull()
    })

    it('checks visits only', () => {
        const r = evaluateReadiness({
            nextLevel: { minVisits: 10, minWeeks: null },
            reachedAt,
            visitsSince: 7,
            now: weeks(1),
        })
        expect(r).toMatchObject({
            ready: false,
            remainingVisits: 3,
            remainingWeeks: 0,
            remainingText: 'ещё 3 тренировки',
        })
    })

    it('checks weeks only', () => {
        const r = evaluateReadiness({
            nextLevel: { minVisits: null, minWeeks: 16 },
            reachedAt,
            visitsSince: 0,
            now: weeks(11),
        })
        expect(r).toMatchObject({
            ready: false,
            weeksSince: 11,
            remainingWeeks: 5,
            remainingText: 'ещё 5 недель',
        })
    })

    it('combines both axes', () => {
        const r = evaluateReadiness({
            nextLevel: { minVisits: 40, minWeeks: 16 },
            reachedAt,
            visitsSince: 19,
            now: weeks(15),
        })
        expect(r.remainingText).toBe('ещё 21 тренировка и 1 неделя')
    })

    it('is ready exactly on the boundaries', () => {
        const r = evaluateReadiness({
            nextLevel: { minVisits: 40, minWeeks: 16 },
            reachedAt,
            visitsSince: 40,
            now: weeks(16),
        })
        expect(r).toMatchObject({
            ready: true,
            remainingVisits: 0,
            remainingWeeks: 0,
            remainingText: null,
        })
    })

    it('is not ready one visit or one day short', () => {
        expect(
            evaluateReadiness({
                nextLevel: { minVisits: 40, minWeeks: 16 },
                reachedAt,
                visitsSince: 39,
                now: weeks(16),
            }).ready,
        ).toBe(false)
        expect(
            evaluateReadiness({
                nextLevel: { minVisits: 40, minWeeks: 16 },
                reachedAt,
                visitsSince: 40,
                now: new Date(weeks(16).getTime() - 86400000),
            }).ready,
        ).toBe(false)
    })
})

describe('describeRemaining plurals', () => {
    it.each([
        [1, 'ещё 1 тренировка'],
        [2, 'ещё 2 тренировки'],
        [5, 'ещё 5 тренировок'],
        [11, 'ещё 11 тренировок'],
        [21, 'ещё 21 тренировка'],
    ])('visits %i', (n, text) => {
        expect(describeRemaining(n, 0)).toBe(text)
    })

    it.each([
        [1, 'ещё 1 неделя'],
        [2, 'ещё 2 недели'],
        [5, 'ещё 5 недель'],
        [11, 'ещё 11 недель'],
        [21, 'ещё 21 неделя'],
    ])('weeks %i', (n, text) => {
        expect(describeRemaining(0, n)).toBe(text)
    })

    it('is null with nothing remaining', () => {
        expect(describeRemaining(0, 0)).toBeNull()
    })
})
