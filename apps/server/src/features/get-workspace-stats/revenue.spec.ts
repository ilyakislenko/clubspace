import {
    computeRevenue,
    dominantCurrency,
    monthlyEquivalent,
} from './revenue'

const day = (n: number) => new Date(2026, 0, n)

describe('monthlyEquivalent', () => {
    it('normalises a 30-day term to its full amount', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 5000,
                currency: 'RUB',
                startDate: day(1),
                endDate: day(31),
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
            }),
        ).toBe(3000)
    })

    it('contributes 0 for an open-ended subscription', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 9999,
                currency: 'RUB',
                startDate: day(1),
                endDate: null,
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
                },
                {
                    amountPaid: 3000,
                    currency: 'RUB',
                    startDate: day(1),
                    endDate: day(31),
                },
                // Foreign-currency row is counted in the total but excluded
                // from the RUB money figures.
                {
                    amountPaid: 100,
                    currency: 'USD',
                    startDate: day(1),
                    endDate: day(31),
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
