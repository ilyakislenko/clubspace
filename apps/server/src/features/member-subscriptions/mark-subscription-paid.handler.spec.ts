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
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2026-10-31T00:00:00Z'),
    durationDays: 30,
    startsOnFirstVisit: false,
    amountPaid: 4500,
    currency: 'RUB',
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

    it('marks with the agreed price when no amount is sent', async () => {
        const { handler, subscriptions } = build()
        const out = await handler.execute(feature())
        expect(subscriptions.markPaid).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            subscriptionId: 's1',
            amount: undefined,
        })
        expect(out.subscription).toMatchObject({
            id: 's1',
            isPaid: true,
            paidAt: '2026-10-24T09:00:00.000Z',
        })
    })

    it('passes an overriding amount through', async () => {
        const { handler, subscriptions } = build()
        await handler.execute(feature(4500))
        expect(subscriptions.markPaid.mock.calls[0][0].amount).toBe(4500)
    })

    it('audits the payment and refreshes member and subscription views', async () => {
        const { handler, audit, realtime } = build()
        await handler.execute(feature(4500))
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.markSubscriptionPaid',
            targetType: 'member',
            targetId: 'u1',
            workspaceId: 'w1',
            actorId: 'inv',
            metadata: { planName: 'Monthly', amount: 4500, currency: 'RUB' },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'members',
            'subscription',
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
