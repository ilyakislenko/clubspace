import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { FreezeSubscriptionFeature } from './freeze-subscription.feature'
import { FreezeSubscriptionHandler } from './freeze-subscription.handler'

const subRow = () => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Monthly' },
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: new Date('2026-11-07T00:00:00Z'),
    amountPaid: 5000,
    currency: 'RUB',
    classesTotal: null,
    classesRemaining: null,
    source: 'MANUAL',
    createdAt: new Date('2026-10-01T00:00:00Z'),
})

const freezeRow = () => ({
    id: 'f1',
    subscriptionId: 's1',
    fromDate: new Date('2026-10-24T00:00:00Z'),
    untilDate: new Date('2026-10-30T00:00:00Z'),
    reason: 'Травма',
    endedEarlyAt: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
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

const build = (admin = true, pending: unknown = null) => {
    const prisma = {
        subscriptionFreezeRequest: {
            findFirst: jest.fn().mockResolvedValue(pending),
        },
    }
    const freezes = {
        create: jest.fn().mockResolvedValue({
            freeze: freezeRow(),
            subscription: subRow(),
            accessUntil: new Date('2026-11-07T00:00:00Z'),
        }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const r = rbac(admin)
    const handler = new FreezeSubscriptionHandler(
        prisma as never,
        r as never,
        freezes as never,
        audit as never,
        realtime as never,
    )
    return { handler, freezes, audit, realtime, rbac: r, prisma }
}

const feature = (roleName: string | null = 'admin', isSuperAdmin = false) =>
    new FreezeSubscriptionFeature(
        { days: 7, reason: 'Травма' },
        'w1',
        'u1',
        's1',
        'inv',
        roleName,
        isSuperAdmin,
    )

describe('FreezeSubscriptionHandler', () => {
    it('refuses a coach freezing their own abonement, an admin may', async () => {
        const coach = build(false)
        await expect(
            coach.handler.execute(
                new FreezeSubscriptionFeature({ days: 7 }, 'w1', 'inv', 's1', 'inv', 'coach', false),
            ),
        ).rejects.toThrow(/собственный абонемент/)
        expect(coach.freezes.create).not.toHaveBeenCalled()

        const admin = build(true)
        await admin.handler.execute(
            new FreezeSubscriptionFeature({ days: 7 }, 'w1', 'inv', 's1', 'inv', 'admin', false),
        )
        expect(admin.freezes.create).toHaveBeenCalled()
    })

    it('forbids a coach of another group without touching the service', async () => {
        const { handler, freezes } = build(false)
        await expect(handler.execute(feature('coach'))).rejects.toThrow(
            /не состоит в ваших группах/,
        )
        expect(freezes.create).not.toHaveBeenCalled()
    })

    it('checks the member against the caller\'s own groups', async () => {
        const { handler, freezes, rbac: r } = build()
        await handler.execute(feature('coach'))
        expect(r.assertCanWriteMember).toHaveBeenCalledWith(
            { scope: 'admin' },
            'u1',
        )
        expect(freezes.create).toHaveBeenCalled()
    })

    it('lets the owner through (rbac resolves the admin scope)', async () => {
        const { handler, freezes } = build()
        await handler.execute(feature(null))
        expect(freezes.create).toHaveBeenCalled()
    })

    it('passes the input through and serializes the result', async () => {
        const { handler, freezes } = build()
        const out = await handler.execute(feature())
        expect(freezes.create).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'u1',
            subscriptionId: 's1',
            days: 7,
            fromDate: undefined,
            reason: 'Травма',
        })
        expect(out.freeze).toMatchObject({
            id: 'f1',
            fromDate: '2026-10-24',
            untilDate: '2026-10-30',
            days: 7,
            reason: 'Травма',
        })
        expect(out.subscription).toMatchObject({ id: 's1', planName: 'Monthly' })
        expect(out.accessUntil).toBe('2026-11-07T00:00:00.000Z')
    })

    it('audits the freeze and refreshes subscription views', async () => {
        const { handler, audit, realtime } = build()
        await handler.execute(feature())
        expect(audit.record).toHaveBeenCalledWith({
            action: 'member.freezeSubscription',
            targetType: 'member',
            targetId: 'u1',
            workspaceId: 'w1',
            actorId: 'inv',
            metadata: {
                planName: 'Monthly',
                fromDate: '2026-10-24',
                untilDate: '2026-10-30',
                days: 7,
                reason: 'Травма',
            },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'members',
            'subscription',
            'attendance',
        ])
    })

    it('propagates a service refusal and records nothing', async () => {
        const { handler, freezes, audit, realtime } = build()
        freezes.create.mockRejectedValue(
            new BadRequestError({ message: 'Заморозка — от 1 до 90 дней' }),
        )
        await expect(handler.execute(feature())).rejects.toThrow(/от 1 до 90/)
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('refuses while the member has a pending freeze request', async () => {
        const { handler, freezes, prisma } = build(true, { id: 'r1' })
        await expect(handler.execute(feature())).rejects.toThrow(
            /есть заявка на заморозку/,
        )
        expect(prisma.subscriptionFreezeRequest.findFirst).toHaveBeenCalledWith({
            where: { subscriptionId: 's1', status: 'PENDING' },
            select: { id: true },
        })
        expect(freezes.create).not.toHaveBeenCalled()
    })
})
