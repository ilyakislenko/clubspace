import {
    computeRevenue,
    dominantCurrency,
    monthlyEquivalent,
    paidInRangeWhere,
    paidOn,
    revenueByPlan,
    revenueTrend,
    summarizeAwaiting,
    sumRevenue,
} from './revenue'

const day = (n: number) => new Date(2026, 0, n)
const utc = (iso: string) => new Date(iso)

describe('monthlyEquivalent', () => {
    it('normalises a 30-day term to its full amount', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 5000,
                currency: 'RUB',
                startDate: day(1),
                endDate: day(31),
                isPaid: true,
            }),
        ).toBe(5000)
    })

    it('halves a ~60-day term', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 6000,
                currency: 'RUB',
                startDate: day(1),
                endDate: new Date(2026, 2, 2), // ~60 days later
                isPaid: true,
            }),
        ).toBe(3000)
    })

    it('contributes 0 for an abonement still waiting for its first visit', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 9999,
                currency: 'RUB',
                startDate: null,
                endDate: null,
                isPaid: true,
            }),
        ).toBe(0)
    })

    it('contributes 0 for an abonement not paid for yet', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 5000,
                currency: 'RUB',
                startDate: day(1),
                endDate: day(31),
                isPaid: false,
            }),
        ).toBe(0)
    })

    it('contributes 0 for an open-ended subscription', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 9999,
                currency: 'RUB',
                startDate: day(1),
                endDate: null,
                isPaid: true,
            }),
        ).toBe(0)
    })
})

describe('dominantCurrency', () => {
    it('returns null with no rows', () => {
        expect(dominantCurrency([])).toBeNull()
    })

    it('picks the most common currency', () => {
        expect(
            dominantCurrency([
                { amountPaid: 1, currency: 'RUB' },
                { amountPaid: 1, currency: 'USD' },
                { amountPaid: 1, currency: 'RUB' },
            ]),
        ).toBe('RUB')
    })
})

describe('computeRevenue', () => {
    it('sums MRR + revenue only in the dominant currency', () => {
        const out = computeRevenue(
            [
                {
                    amountPaid: 5000,
                    currency: 'RUB',
                    startDate: day(1),
                    endDate: day(31),
                    isPaid: true,
                },
                {
                    amountPaid: 3000,
                    currency: 'RUB',
                    startDate: day(1),
                    endDate: day(31),
                    isPaid: true,
                },
                // Foreign-currency row is counted in the total but excluded
                // from the RUB money figures.
                {
                    amountPaid: 100,
                    currency: 'USD',
                    startDate: day(1),
                    endDate: day(31),
                    isPaid: true,
                },
            ],
            [
                { amountPaid: 5000, currency: 'RUB' },
                { amountPaid: 100, currency: 'USD' },
            ],
        )
        expect(out).toEqual({
            activeSubscriptions: 3,
            revenue30d: 5000,
            mrr: 8000,
            currency: 'RUB',
        })
    })

    it('is all-zero / null when there are no subscriptions', () => {
        expect(computeRevenue([], [])).toEqual({
            activeSubscriptions: 0,
            revenue30d: 0,
            mrr: 0,
            currency: null,
        })
    })
})

describe('revenueTrend', () => {
    const now = utc('2026-07-15T12:00:00Z')

    it('emits one bucket per month, oldest first, current month last', () => {
        const out = revenueTrend([], now, 'RUB', 6)
        expect(out.map((b) => b.month)).toEqual([
            '2026-02',
            '2026-03',
            '2026-04',
            '2026-05',
            '2026-06',
            '2026-07',
        ])
        expect(out.every((b) => b.revenue === 0)).toBe(true)
    })

    it('buckets a sale by the month it was paid, not sold', () => {
        const out = revenueTrend(
            [
                {
                    amountPaid: 5000,
                    currency: 'RUB',
                    createdAt: utc('2026-06-28T00:00:00Z'),
                    paidAt: utc('2026-07-02T00:00:00Z'),
                },
            ],
            now,
            'RUB',
            6,
        )
        const byMonth = Object.fromEntries(out.map((b) => [b.month, b.revenue]))
        expect(byMonth['2026-07']).toBe(5000)
        expect(byMonth['2026-06']).toBe(0)
    })

    it('sums amounts into the right month, dominant currency only', () => {
        const out = revenueTrend(
            [
                { amountPaid: 5000, currency: 'RUB', createdAt: utc('2026-07-01T00:00:00Z') },
                { amountPaid: 3000, currency: 'RUB', createdAt: utc('2026-07-10T00:00:00Z') },
                { amountPaid: 4000, currency: 'RUB', createdAt: utc('2026-06-20T00:00:00Z') },
                // Foreign currency is excluded from the figures.
                { amountPaid: 999, currency: 'USD', createdAt: utc('2026-07-05T00:00:00Z') },
            ],
            now,
            'RUB',
            6,
        )
        const byMonth = Object.fromEntries(out.map((b) => [b.month, b.revenue]))
        expect(byMonth['2026-07']).toBe(8000)
        expect(byMonth['2026-06']).toBe(4000)
        expect(byMonth['2026-05']).toBe(0)
    })
})

describe('sumRevenue', () => {
    it('is zero / null with no rows', () => {
        expect(sumRevenue([])).toEqual({ amount: 0, currency: null })
    })

    it('sums only the dominant currency', () => {
        expect(
            sumRevenue([
                { amountPaid: 800, currency: 'RUB' },
                { amountPaid: 4000, currency: 'RUB' },
                { amountPaid: 50, currency: 'USD' },
            ]),
        ).toEqual({ amount: 4800, currency: 'RUB' })
    })
})

describe('revenueByPlan', () => {
    it('groups by tariff, counts + sums, highest revenue first', () => {
        const out = revenueByPlan(
            [
                { planId: 'p1', planName: 'Абонемент 8', amountPaid: 4000, currency: 'RUB' },
                { planId: 'p2', planName: 'Разовое', amountPaid: 800, currency: 'RUB' },
                { planId: 'p1', planName: 'Абонемент 8', amountPaid: 4000, currency: 'RUB' },
                // Foreign currency row dropped.
                { planId: 'p3', planName: 'Trial', amountPaid: 50, currency: 'USD' },
            ],
            'RUB',
        )
        expect(out).toEqual([
            { planId: 'p1', planName: 'Абонемент 8', count: 2, revenue: 8000 },
            { planId: 'p2', planName: 'Разовое', count: 1, revenue: 800 },
        ])
    })

    it('is empty with no rows', () => {
        expect(revenueByPlan([], 'RUB')).toEqual([])
    })
})

describe('paidOn', () => {
    it('is the payment date, or the sale date on a legacy row', () => {
        const createdAt = utc('2026-07-01T00:00:00Z')
        expect(paidOn({ createdAt, paidAt: utc('2026-07-05T00:00:00Z') })).toEqual(
            utc('2026-07-05T00:00:00Z'),
        )
        expect(paidOn({ createdAt, paidAt: null })).toEqual(createdAt)
    })
})

describe('paidInRangeWhere', () => {
    it('is just isPaid when unbounded', () => {
        expect(paidInRangeWhere({})).toEqual({ isPaid: true })
    })

    it('matches paidAt in range, or the sale date on a row with no paidAt', () => {
        const gte = utc('2026-07-01T00:00:00Z')
        const lte = utc('2026-07-31T00:00:00Z')
        expect(paidInRangeWhere({ gte, lte })).toEqual({
            isPaid: true,
            OR: [
                { paidAt: { gte, lte } },
                { paidAt: null, createdAt: { gte, lte } },
            ],
        })
    })
})

describe('summarizeAwaiting', () => {
    it('counts every row and sums the given currency', () => {
        expect(
            summarizeAwaiting(
                [
                    { amountPaid: 5000, currency: 'RUB' },
                    { amountPaid: 3000, currency: 'RUB' },
                    { amountPaid: 100, currency: 'USD' },
                ],
                'RUB',
            ),
        ).toEqual({ count: 3, amount: 8000 })
    })

    it('falls back to its own dominant currency, and is zero when empty', () => {
        expect(
            summarizeAwaiting([{ amountPaid: 700, currency: 'EUR' }], null),
        ).toEqual({ count: 1, amount: 700 })
        expect(summarizeAwaiting([], null)).toEqual({ count: 0, amount: 0 })
    })
})
