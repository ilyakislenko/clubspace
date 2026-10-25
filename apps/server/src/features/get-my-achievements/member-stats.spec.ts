import { memberStats } from './member-stats'

const msk = (iso: string) => ({
    startAt: new Date(iso),
    timezone: 'Europe/Moscow',
})
const base = { completedSubscriptions: 2 }

// Two classes a week from `from`, up to and including `to`.
const twiceWeekly = (from: string, to: string) => {
    const out = []
    for (
        let t = new Date(from).getTime();
        t <= new Date(to).getTime();
        t += 3.5 * 86_400_000
    ) {
        out.push(msk(new Date(t).toISOString()))
    }
    return out
}

describe('memberStats', () => {
    it('is empty without visits', () => {
        expect(
            memberStats({ ...base, visits: [], now: new Date() }),
        ).toEqual({
            firstTrainingDate: null,
            monthsTraining: 0,
            avgPerMonth: 0,
            completedSubscriptions: 2,
        })
    })

    it('counts full calendar months', () => {
        const out = memberStats({
            ...base,
            visits: [msk('2025-12-16T15:00:00Z')],
            now: new Date('2026-10-24T10:00:00Z'),
        })
        expect(out.firstTrainingDate).toBe('2025-12-16')
        expect(out.monthsTraining).toBe(10)
    })

    it('does not count an unfinished month', () => {
        const out = memberStats({
            ...base,
            visits: [msk('2026-01-20T10:00:00Z')],
            now: new Date('2026-03-19T10:00:00Z'),
        })
        expect(out.monthsTraining).toBe(1)
    })

    it('clamps the anchor day to a shorter month', () => {
        const out = memberStats({
            ...base,
            visits: [msk('2026-01-31T10:00:00Z')],
            now: new Date('2026-02-28T10:00:00Z'),
        })
        expect(out.monthsTraining).toBe(1)
    })

    it('averages over elapsed time, so the day a month completes does not jump', () => {
        const visits = twiceWeekly('2026-01-20T10:00:00Z', '2026-03-19T10:00:00Z')
        const before = memberStats({
            ...base,
            visits,
            now: new Date('2026-03-19T12:00:00Z'),
        })
        const after = memberStats({
            ...base,
            visits,
            now: new Date('2026-03-20T12:00:00Z'),
        })
        expect(before.avgPerMonth).toBeGreaterThan(8)
        expect(before.avgPerMonth).toBeLessThan(9.5)
        expect(Math.abs(after.avgPerMonth - before.avgPerMonth)).toBeLessThan(0.5)
    })

    it('uses at least one month as the divisor', () => {
        const out = memberStats({
            ...base,
            visits: [
                msk('2026-10-20T10:00:00Z'),
                msk('2026-10-22T10:00:00Z'),
                msk('2026-10-23T10:00:00Z'),
            ],
            now: new Date('2026-10-24T10:00:00Z'),
        })
        expect(out.monthsTraining).toBe(0)
        expect(out.avgPerMonth).toBe(3)
    })

    it('dates the first class in the session timezone, not the club default', () => {
        const out = memberStats({
            ...base,
            visits: [
                {
                    startAt: new Date('2026-05-31T21:30:00Z'),
                    timezone: 'Asia/Vladivostok',
                },
                msk('2026-06-10T10:00:00Z'),
            ],
            now: new Date('2026-06-12T10:00:00Z'),
        })
        expect(out.firstTrainingDate).toBe('2026-06-01')
    })
})
