import { computeStreakWeeks, rankEntries, weekIndex } from './leaderboard-math'

describe('computeStreakWeeks', () => {
    it('counts consecutive weeks ending at the current week', () => {
        expect(computeStreakWeeks([100, 99, 98], 100)).toBe(3)
    })

    it('gives a one-week grace when the current week is empty', () => {
        // Nothing this week (100) but a run ending last week (99).
        expect(computeStreakWeeks([99, 98], 100)).toBe(2)
    })

    it('is 0 when the streak is broken (gap before current)', () => {
        expect(computeStreakWeeks([98, 97], 100)).toBe(0)
    })

    it('stops at the first gap', () => {
        expect(computeStreakWeeks([100, 99, 97], 100)).toBe(2)
    })

    it('dedupes multiple check-ins in the same week', () => {
        expect(computeStreakWeeks([100, 100, 100, 99], 100)).toBe(2)
    })

    it('is 0 with no attendance', () => {
        expect(computeStreakWeeks([], 100)).toBe(0)
    })
})

describe('rankEntries', () => {
    const e = (userId: string, name: string, checkins: number) => ({
        userId,
        name,
        checkins,
    })

    it('ranks by check-ins desc, ties by name', () => {
        const out = rankEntries([
            e('a', 'Ann', 3),
            e('b', 'Bob', 10),
            e('c', 'Cy', 3),
        ])
        expect(out.map((x) => [x.userId, x.rank])).toEqual([
            ['b', 1],
            ['a', 2],
            ['c', 2],
        ])
    })

    it('uses competition ranking (shared rank then a skip)', () => {
        const out = rankEntries([
            e('a', 'A', 5),
            e('b', 'B', 5),
            e('c', 'C', 1),
        ])
        expect(out.map((x) => x.rank)).toEqual([1, 1, 3])
    })

    it('does not mutate the input', () => {
        const input = [e('a', 'A', 1), e('b', 'B', 2)]
        rankEntries(input)
        expect(input.map((x) => x.userId)).toEqual(['a', 'b'])
    })
})

describe('weekIndex', () => {
    it('places timestamps 7 days apart in adjacent buckets', () => {
        const a = new Date('2026-07-06T12:00:00Z')
        const b = new Date('2026-07-13T12:00:00Z')
        expect(weekIndex(b) - weekIndex(a)).toBe(1)
    })
})
