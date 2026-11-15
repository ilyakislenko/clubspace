import {
    computeRevenue,
    type DatedSubRow,
    dominantCurrency,
    loadRefunds,
    monthlyEquivalent,
    netRevenue,
    paidInRangeWhere,
    paidOn,
    type RefundRow,
    refundsInRangeWhere,
    revenueByPlan,
    revenueTrend,
    revenueTrendStart,
    summarizeAwaiting,
    sumRevenue,
} from './revenue'

const day = (n: number) => new Date(2026, 0, n)
const utc = (iso: string) => new Date(iso)
// A refund of an abonement of tariff p1, by refund date.
const refund = (amount: number, at: string, currency = 'RUB'): RefundRow => ({
    amount,
    currency,
    refundedAt: new Date(at),
    planId: 'p1',
    planName: 'Абонемент 8',
})

describe('monthlyEquivalent', () => {
    it('normalises a 30-day term to its full amount', () => {
        expect(
            monthlyEquivalent({
                amountPaid: 5000,
                currency: 'RUB',
                startDate: day(1),
                endDate: day(31),
                isPaid: true,
                refundedAmount: 0,
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
                refundedAmount: 0,
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
                refundedAmount: 0,
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
                refundedAmount: 0,
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
                refundedAmount: 0,
            }),
        ).toBe(0)
    })

    it('counts what is left after refunds; a full refund adds 0', () => {
        const row = {
            amountPaid: 5000,
            currency: 'RUB',
            startDate: day(1),
            endDate: day(31),
            isPaid: true,
        }
        expect(monthlyEquivalent({ ...row, refundedAmount: 2000 })).toBe(3000)
        expect(monthlyEquivalent({ ...row, refundedAmount: 5000 })).toBe(0)
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
                    refundedAmount: 0,
                },
                {
                    amountPaid: 3000,
                    currency: 'RUB',
                    startDate: day(1),
                    endDate: day(31),
                    isPaid: true,
                    refundedAmount: 0,
                },
                // A foreign-currency row stays out of the RUB money figures.
                {
                    amountPaid: 100,
                    currency: 'USD',
                    startDate: day(1),
                    endDate: day(31),
                    isPaid: true,
                    refundedAmount: 0,
                },
            ],
            [
                { amountPaid: 5000, currency: 'RUB' },
                { amountPaid: 100, currency: 'USD' },
            ],
            [],
        )
        expect(out).toEqual({
            revenue30d: 5000,
            refunded30d: 0,
            mrr: 8000,
            currency: 'RUB',
        })
    })

    it('is all-zero / null when there are no subscriptions', () => {
        expect(computeRevenue([], [], [])).toEqual({
            revenue30d: 0,
            refunded30d: 0,
            mrr: 0,
            currency: null,
        })
    })

    // Payments journal §1: revenue = sales − refunds of sales in the window.
    it('nets the window’s refunds off revenue30d and reports them', () => {
        const out = computeRevenue(
            [
                {
                    amountPaid: 5000,
                    refundedAmount: 1000,
                    currency: 'RUB',
                    startDate: day(1),
                    endDate: day(31),
                    isPaid: true,
                },
            ],
            [
                { amountPaid: 5000, currency: 'RUB' },
                { amountPaid: 3000, currency: 'RUB' },
            ],
            [
                refund(1000, '2026-07-10T00:00:00Z'),
                refund(500, '2026-07-12T00:00:00Z'),
                // Another currency never moves the RUB figure.
                refund(50, '2026-07-12T00:00:00Z', 'USD'),
            ],
        )
        expect(out).toEqual({ revenue30d: 6500, refunded30d: 1500, mrr: 4000, currency: 'RUB' })
    })

    it('never lets a refund pick the currency', () => {
        const out = computeRevenue(
            [],
            [{ amountPaid: 5000, currency: 'RUB' }],
            [refund(100, '2026-07-10T00:00:00Z', 'USD'), refund(100, '2026-07-10T00:00:00Z', 'USD')],
        )
        expect(out).toMatchObject({ currency: 'RUB', revenue30d: 5000, refunded30d: 0 })
    })
})

describe('revenueTrend', () => {
    const now = utc('2026-07-15T12:00:00Z')

    it('emits one bucket per month, oldest first, current month last', () => {
        const out = revenueTrend([], now, 'RUB', 'UTC', 6)
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
            'UTC',
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
            'UTC',
            6,
        )
        const byMonth = Object.fromEntries(out.map((b) => [b.month, b.revenue]))
        expect(byMonth['2026-07']).toBe(8000)
        expect(byMonth['2026-06']).toBe(4000)
        expect(byMonth['2026-05']).toBe(0)
    })

    // Asia/Tomsk is UTC+7 all year: its months start at 17:00 UTC the day before.
    describe('in the club timezone (Asia/Tomsk)', () => {
        const TZ = 'Asia/Tomsk'
        const sale = (iso: string) => ({ amountPaid: 1000, currency: 'RUB', createdAt: utc(iso) })
        const byMonth = (rows: DatedSubRow[], at: Date) =>
            Object.fromEntries(revenueTrend(rows, at, 'RUB', TZ, 6).map((b) => [b.month, b.revenue]))

        it('puts a sale at local midnight of the 1st into the new month', () => {
            const out = byMonth(
                [
                    // 30 Jun 23:59:59 in Томск.
                    sale('2026-06-30T16:59:59Z'),
                    // 1 Jul 00:00 in Томск — still June in UTC.
                    sale('2026-06-30T17:00:00Z'),
                    sale('2026-06-30T20:00:00Z'),
                ],
                now,
            )
            expect(out['2026-06']).toBe(1000)
            expect(out['2026-07']).toBe(2000)
        })

        it('takes the current month from the club clock, across a year end', () => {
            // 1 Feb 01:00 in Томск, 31 Jan in UTC.
            const at = utc('2026-01-31T18:00:00Z')
            expect(revenueTrend([], at, 'RUB', TZ, 6).map((b) => b.month)).toEqual([
                '2025-09',
                '2025-10',
                '2025-11',
                '2025-12',
                '2026-01',
                '2026-02',
            ])
            expect(byMonth([sale('2026-01-31T17:30:00Z')], at)['2026-02']).toBe(1000)
        })

        it('starts the window at local midnight of the oldest month’s 1st', () => {
            const start = revenueTrendStart(now, TZ)
            expect(start.toISOString()).toBe('2026-01-31T17:00:00.000Z')
            const out = byMonth(
                [sale(start.toISOString()), sale(new Date(start.getTime() - 1).toISOString())],
                now,
            )
            // The first is the oldest bucket; the second falls outside the window.
            expect(out['2026-02']).toBe(1000)
            expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(1000)
        })

        it('crosses a year boundary when the window does', () => {
            expect(revenueTrendStart(utc('2026-03-10T00:00:00Z'), TZ).toISOString()).toBe(
                '2025-09-30T17:00:00.000Z',
            )
        })
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

// Payments journal §1: a refund of a sale lowers the window it was made in,
// whenever the sale was; an unapplied payment's refund is never read.
describe('refunds in the money figures', () => {
    const now = utc('2026-07-15T12:00:00Z')
    const windowStart = utc('2026-06-15T12:00:00Z')
    const prevStart = utc('2026-05-16T12:00:00Z')
    const sale = (amountPaid: number, iso: string) => ({
        amountPaid,
        currency: 'RUB',
        createdAt: utc(iso),
    })

    it('nets revenuePrev30d by refund date: a refund now of an old sale lowers the current window', () => {
        const sales = [sale(4000, '2026-05-20T00:00:00Z'), sale(5000, '2026-07-01T00:00:00Z')]
        // The old sale is refunded inside the current window.
        const refunds = [refund(1000, '2026-07-10T00:00:00Z'), refund(300, '2026-06-01T00:00:00Z')]
        expect(netRevenue(sales, refunds, 'RUB', { gte: prevStart, lt: windowStart })).toBe(3700)
        expect(netRevenue(sales, refunds, 'RUB', { gte: windowStart })).toBe(4000)
        // Another currency's refund never moves the figure.
        expect(
            netRevenue(sales, [refund(50, '2026-07-10T00:00:00Z', 'USD')], 'RUB', { gte: windowStart }),
        ).toBe(5000)
    })

    it('lowers the month a refund was made in on the trend', () => {
        const out = revenueTrend(
            [sale(5000, '2026-06-20T00:00:00Z')],
            now,
            'RUB',
            'UTC',
            6,
            [refund(2000, '2026-07-02T00:00:00Z')],
        )
        const byMonth = Object.fromEntries(out.map((b) => [b.month, b.revenue]))
        expect(byMonth['2026-06']).toBe(5000)
        expect(byMonth['2026-07']).toBe(-2000)
    })

    it('takes a refund off its tariff without counting it as a sale', () => {
        expect(
            revenueByPlan(
                [{ planId: 'p1', planName: 'Абонемент 8', amountPaid: 4000, currency: 'RUB' }],
                'RUB',
                [refund(1000, '2026-07-02T00:00:00Z')],
            ),
        ).toEqual([{ planId: 'p1', planName: 'Абонемент 8', count: 1, revenue: 3000 }])
    })

    it('nets today’s refunds off today’s revenue; with no sales, the refunds’ currency', () => {
        expect(
            sumRevenue([{ amountPaid: 4000, currency: 'RUB' }], [refund(1000, '2026-07-15T08:00:00Z')]),
        ).toEqual({ amount: 3000, currency: 'RUB' })
        expect(sumRevenue([], [refund(1000, '2026-07-15T08:00:00Z')])).toEqual({
            amount: -1000,
            currency: 'RUB',
        })
    })

    it('reads refunds of sales only — never of an unapplied online payment', () => {
        expect(refundsInRangeWhere({ gte: windowStart })).toEqual({
            refundedAt: { gte: windowStart },
            OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }],
        })
    })

    it('loads refunds keyed like their sale: the tariff of an abonement, the event of a ticket', async () => {
        const findMany = jest.fn().mockResolvedValue([
            {
                amount: 1000,
                currency: 'RUB',
                refundedAt: utc('2026-07-10T00:00:00Z'),
                subscription: { planId: 'p1', plan: { name: 'Абонемент 8' } },
                eventRegistration: null,
            },
            {
                amount: 500,
                currency: 'RUB',
                refundedAt: utc('2026-07-11T00:00:00Z'),
                subscription: null,
                eventRegistration: { eventId: 'e1', event: { title: 'Семинар' } },
            },
        ])
        const rows = await loadRefunds({ refund: { findMany } } as never, 'w1', windowStart)
        expect(findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            ...refundsInRangeWhere({ gte: windowStart }),
        })
        expect(rows).toEqual([
            refund(1000, '2026-07-10T00:00:00Z'),
            { amount: 500, currency: 'RUB', refundedAt: utc('2026-07-11T00:00:00Z'), planId: 'e1', planName: 'Семинар' },
        ])
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
