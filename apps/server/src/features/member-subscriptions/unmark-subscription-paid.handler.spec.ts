import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { UnmarkSubscriptionPaidFeature } from './unmark-subscription-paid.feature'
import { UnmarkSubscriptionPaidHandler } from './unmark-subscription-paid.handler'

const unpaidRow = () => ({
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
    isPaid: false,
    paidAt: null,
    classesTotal: null,
    classesRemaining: null,
    source: 'MANUAL',
    createdAt: new Date('2026-10-01T00:00:00Z'),
})

const build = (admin = true) => {
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
        canWriteAllGroups: jest.fn().mockReturnValue(admin),
    }
    const subscriptions = {
        unmarkPaid: jest.fn().mockResolvedValue(unpaidRow()),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const handler = new UnmarkSubscriptionPaidHandler(
        rbac as never,
        subscriptions as never,
        audit as never,
        realtime as never,
    )
    return { handler, rbac, subscriptions, audit, realtime }
}

const feature = (roleName: string | null = 'admin') =>
    new UnmarkSubscriptionPaidFeature('w1', 'u1', 's1', 'inv', roleName, false)

describe('UnmarkSubscriptionPaidHandler', () => {
    it('forbids a coach without touching the service', async () => {
        const { handler, subscriptions, audit } = build(false)
        await expect(handler.execute(feature('coach'))).rejects.toThrow(
            ForbiddenError,
        )
        await expect(handler.execute(feature('coach'))).rejects.toThrow(
            /только администратор клуба/,
        )
        expect(subscriptions.unmarkPaid).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('undoes the payment, audits it and invalidates the club', async () => {
        const { handler, subscriptions, audit, realtime } = build()
        const res = await handler.execute(feature())
        expect(subscriptions.unmarkPaid).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            subscriptionId: 's1',
        })
        expect(res.subscription).toMatchObject({
            id: 's1',
            isPaid: false,
            paidAt: null,
            amountPaid: 4500,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.unmarkSubscriptionPaid',
                targetId: 'u1',
                workspaceId: 'w1',
                actorId: 'inv',
                metadata: { planName: 'Monthly', amount: 4500, currency: 'RUB' },
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'members',
            'subscription',
        ])
    })

    it('passes the service refusal through (not paid -> 400) with no audit', async () => {
        const { handler, subscriptions, audit, realtime } = build()
        subscriptions.unmarkPaid.mockRejectedValue(
            new BadRequestError({ message: 'Оплата не отмечена' }),
        )
        await expect(handler.execute(feature())).rejects.toThrow(
            /Оплата не отмечена/,
        )
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })
})
