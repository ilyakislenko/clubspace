jest.mock('../../features/online-payments/load-buyer', () => ({ PENDING_REUSE_MS: 30 * 60 * 1000 }))

import { countDiscountUses, countUsesByDiscount } from './discount-uses'

const db = (subs = 0, tickets = 0, payments = 0) => ({
    subscription: { count: jest.fn().mockResolvedValue(subs), groupBy: jest.fn() },
    eventRegistration: { count: jest.fn().mockResolvedValue(tickets), groupBy: jest.fn() },
    payment: { count: jest.fn().mockResolvedValue(payments) },
})

describe('countDiscountUses', () => {
    it('counts sales of both kinds except an unpaid one later cancelled; refunded ones count', async () => {
        const d = db(2, 1)
        expect(await countDiscountUses(d as never, 'd1')).toBe(3)
        const where = { discountId: 'd1', NOT: { status: 'CANCELLED', isPaid: false } }
        expect(d.subscription.count).toHaveBeenCalledWith({ where })
        expect(d.eventRegistration.count).toHaveBeenCalledWith({ where })
        // No refund condition: a refund never gives a use back.
        expect(JSON.stringify(d.subscription.count.mock.calls[0][0])).not.toContain('refund')
        expect(d.payment.count).not.toHaveBeenCalled()
    })

    it('narrows to one member', async () => {
        const d = db()
        await countDiscountUses(d as never, 'd1', { userId: 'u1' })
        expect(d.subscription.count.mock.calls[0][0].where.userId).toBe('u1')
        expect(d.eventRegistration.count.mock.calls[0][0].where.userId).toBe('u1')
    })

    it('online: adds open checkouts within the reuse window, except the caller’s own', async () => {
        const d = db(1, 0, 2)
        const now = new Date('2027-03-01T12:00:00Z')
        expect(
            await countDiscountUses(d as never, 'd1', {
                userId: 'u1',
                includePending: { now, excludePaymentId: 'pay-own' },
            }),
        ).toBe(3)
        expect(d.payment.count).toHaveBeenCalledWith({
            where: {
                discountId: 'd1',
                status: 'PENDING',
                createdAt: { gte: new Date('2027-03-01T11:30:00Z') },
                userId: 'u1',
                NOT: { id: 'pay-own' },
            },
        })
    })
})

describe('countUsesByDiscount', () => {
    it('sums both tables per discount', async () => {
        const d = db()
        d.subscription.groupBy.mockResolvedValue([
            { discountId: 'd1', _count: { _all: 2 } },
            { discountId: 'd2', _count: { _all: 1 } },
        ])
        d.eventRegistration.groupBy.mockResolvedValue([{ discountId: 'd1', _count: { _all: 3 } }])
        const out = await countUsesByDiscount(d as never, ['d1', 'd2'], 'u1')
        expect(out).toEqual(new Map([['d1', 5], ['d2', 1]]))
        expect(d.subscription.groupBy.mock.calls[0][0].where).toEqual({
            discountId: { in: ['d1', 'd2'] },
            NOT: { status: 'CANCELLED', isPaid: false },
            userId: 'u1',
        })
    })

    it('asks nothing for no discounts', async () => {
        const d = db()
        expect(await countUsesByDiscount(d as never, [])).toEqual(new Map())
        expect(d.subscription.groupBy).not.toHaveBeenCalled()
    })
})
