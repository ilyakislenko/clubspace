import { memberStats } from './member-stats'

const base = { completedSubscriptions: 2, timezone: 'Europe/Moscow' }

describe('memberStats', () => {
    it('is empty without visits', () => {
        expect(
            memberStats({ ...base, visitStarts: [], now: new Date() }),
        ).toEqual({
            firstTrainingDate: null,
            monthsTraining: 0,
            avgPerMonth: 0,
            completedSubscriptions: 2,
        })
    })

    it('counts full calendar months and averages per month', () => {
        const visitStarts = Array.from(
            { length: 50 },
            (_, i) => new Date(Date.UTC(2025, 11, 16, 15 + (i % 2), 0)),
        )
        const out = memberStats({
            ...base,
            visitStarts,
            now: new Date('2026-10-24T10:00:00Z'),
        })
        expect(out.firstTrainingDate).toBe('2025-12-16')
        expect(out.monthsTraining).toBe(10)
        expect(out.avgPerMonth).toBe(5)
    })

    it('does not count an unfinished month', () => {
        const out = memberStats({
            ...base,
            visitStarts: [new Date('2026-01-20T10:00:00Z')],
            now: new Date('2026-03-19T10:00:00Z'),
        })
        expect(out.monthsTraining).toBe(1)
    })

    it('uses at least one month as the divisor', () => {
        const out = memberStats({
            ...base,
            visitStarts: [
                new Date('2026-10-20T10:00:00Z'),
                new Date('2026-10-22T10:00:00Z'),
                new Date('2026-10-23T10:00:00Z'),
            ],
            now: new Date('2026-10-24T10:00:00Z'),
        })
        expect(out.monthsTraining).toBe(0)
        expect(out.avgPerMonth).toBe(3)
    })

    it('takes the first date in the club timezone', () => {
        const out = memberStats({
            ...base,
            visitStarts: [new Date('2026-05-31T21:30:00Z')],
            now: new Date('2026-06-02T10:00:00Z'),
        })
        expect(out.firstTrainingDate).toBe('2026-06-01')
    })

    it('rounds the average to one decimal', () => {
        const out = memberStats({
            ...base,
            visitStarts: Array.from(
                { length: 10 },
                () => new Date('2026-01-10T10:00:00Z'),
            ),
            now: new Date('2026-04-10T10:00:00Z'),
        })
        expect(out.monthsTraining).toBe(3)
        expect(out.avgPerMonth).toBe(3.3)
    })
})
