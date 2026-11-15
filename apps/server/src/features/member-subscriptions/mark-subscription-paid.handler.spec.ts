import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { MarkSubscriptionPaidFeature } from './mark-subscription-paid.feature'
import { MarkSubscriptionPaidHandler } from './mark-subscription-paid.handler'

const paidRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Monthly' },
    directions: [],
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2026-10-31T00:00:00Z'),
    durationDays: 30,
    startsOnFirstVisit: false,
    amountPaid: 4500,
    currency: 'RUB',
    refundedAmount: 0,
    listPrice: null,
    discountId: null,
    discountName: null,
    discountAmount: 0,
    pricedById: null,
    isPaid: true,
    paidAt: new Date('2026-10-24T09:00:00Z'),
    classesTotal: null,
    classesRemaining: null,
    source: 'MANUAL',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
})

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
    assertCanWriteMember: jest.fn().mockImplementation(async () => {
        if (!admin) {
            throw new ForbiddenError({
                message: 'Участник не состоит в ваших группах',
            })
        }
    }),
})

const build = (admin = true) => {
    const subscriptions = { markPaid: jest.fn().mockResolvedValue(paidRow()) }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const r = rbac(admin)
    const handler = new MarkSubscriptionPaidHandler(
        r as never,
        subscriptions as never,
        audit as never,
        realtime as never,
    )
    return { handler, subscriptions, audit, realtime, rbac: r }
}

const feature = (
    amount?: number,
    roleName: string | null = 'admin',
    isSuperAdmin = false,
) =>
    new MarkSubscriptionPaidFeature(
        { amount },
        'w1',
        'u1',
        's1',
        'inv',
        roleName,
        isSuperAdmin,
    )

describe('MarkSubscriptionPaidHandler', () => {
    it('refuses a coach marking their own abonement paid, an admin may', async () => {
        const coach = build(false)
        await expect(
            coach.handler.execute(
                new MarkSubscriptionPaidFeature({}, 'w1', 'inv', 's1', 'inv', 'coach', false),
            ),
        ).rejects.toThrow(/собственного абонемента/)
        expect(coach.subscriptions.markPaid).not.toHaveBeenCalled()

        const admin = build(true)
        await admin.handler.execute(
            new MarkSubscriptionPaidFeature({}, 'w1', 'inv', 's1', 'inv', 'admin', false),
        )
        expect(admin.subscriptions.markPaid).toHaveBeenCalled()
    })

    it('forbids a coach outside the member\'s groups without touching the service', async () => {
        const { handler, subscriptions } = build(false)
        await expect(handler.execute(feature(undefined, 'coach'))).rejects.toThrow(
            /не состоит в ваших группах/,
        )
        expect(subscriptions.markPaid).not.toHaveBeenCalled()
    })

    it('checks the member against the caller\'s own groups', async () => {
        const { handler, rbac: r } = build()
        await handler.execute(feature(undefined, 'coach'))
        expect(r.assertCanWriteMember).toHaveBeenCalledWith(
            { scope: 'admin' },
            'u1',
        )
    })

    it('lets the owner through (rbac resolves the admin scope)', async () => {
        const { handler, subscriptions } = build()
        await handler.execute(feature(undefined, null))
        expect(subscriptions.markPaid).toHaveBeenCalled()
    })

    it('marks with the agreed price when no amount is sent, as the caller', async () => {
        const { handler, subscriptions } = build()
        const out = await handler.execute(feature())
        expect(subscriptions.markPaid).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            subscriptionId: 's1',
            amount: undefined,
            discountId: undefined,
            // The caller is the journal's «Отметил».
            markedById: 'inv',
        })
        expect(out.subscription).toMatchObject({
            id: 's1',
            isPaid: true,
            paidAt: '2026-10-24T09:00:00.000Z',
        })
    })

    it('passes the payment method picked through', async () => {
        const { handler, subscriptions } = build()
        await handler.execute(
            new MarkSubscriptionPaidFeature({ method: 'CASH' }, 'w1', 'u1', 's1', 'inv', 'admin', false),
        )
        expect(subscriptions.markPaid.mock.calls[0][0].paymentMethod).toBe('CASH')
    })

    it('passes an overriding amount through', async () => {
        const { handler, subscriptions } = build()
        await handler.execute(feature(4500))
        expect(subscriptions.markPaid.mock.calls[0][0].amount).toBe(4500)
    })

    it('passes a picked discount through to the service (which prices it in its transaction)', async () => {
        const { handler, subscriptions } = build()
        await handler.execute(
            new MarkSubscriptionPaidFeature({ discountId: 'd1' }, 'w1', 'u1', 's1', 'inv', 'coach', false),
        )
        expect(subscriptions.markPaid.mock.calls[0][0].discountId).toBe('d1')
    })

    it('a coach typing a lower amount is accepted, as today, and audited as a one-off discount by them', async () => {
        const { handler, audit, subscriptions } = build()
        subscriptions.markPaid.mockResolvedValue(
            paidRow({ amountPaid: 4000, listPrice: 5000, pricedById: 'inv' }),
        )
        const out = await handler.execute(feature(4000, 'coach'))
        expect(subscriptions.markPaid.mock.calls[0][0].amount).toBe(4000)
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            actorId: 'inv',
            metadata: { amount: 4000, listPrice: 5000, oneOff: 1000 },
        })
        expect(out.subscription).toMatchObject({ listPrice: 5000, oneOffDiscount: 1000 })
    })

    it('audits the payment with the abonement and method, refreshes members, abonements and «Платежи»', async () => {
        const { handler, audit, realtime, subscriptions } = build()
        subscriptions.markPaid.mockResolvedValue(paidRow({ paymentMethod: 'CASH' }))
        await handler.execute(feature(4500))
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.markSubscriptionPaid',
            targetType: 'member',
            targetId: 'u1',
            workspaceId: 'w1',
            actorId: 'inv',
            metadata: {
                subscriptionId: 's1',
                planName: 'Monthly',
                amount: 4500,
                currency: 'RUB',
                method: 'CASH',
                listPrice: null,
                discountId: null,
                discountName: null,
                discountAmount: 0,
            },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'members',
            'subscription',
            'payments',
        ])
    })

    it.each([
        ['not found', new NotFoundError({ message: 'Абонемент не найден' })],
        ['cancelled', new BadRequestError({ message: 'Абонемент отменён — отметить оплату нельзя' })],
        ['already paid', new BadRequestError({ message: 'Оплата уже отмечена 22 октября' })],
    ])('propagates a service refusal (%s) and records nothing', async (_n, err) => {
        const { handler, subscriptions, audit, realtime } = build()
        subscriptions.markPaid.mockRejectedValue(err)
        await expect(handler.execute(feature())).rejects.toBe(err)
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })
})
