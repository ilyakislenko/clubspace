import { ListMemberSubscriptionsFeature } from './list-member-subscriptions.feature'
import { ListMemberSubscriptionsHandler } from './list-member-subscriptions.handler'

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Monthly' },
    status: 'ACTIVE',
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: new Date('2999-01-01T00:00:00Z'),
    amountPaid: 5000,
    currency: 'RUB',
    classesTotal: null,
    classesRemaining: null,
    source: 'MANUAL',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
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
})

const build = (subs: unknown[], freezes: unknown[] = []) => {
    const prisma = {
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue({ id: 'm1', subscriptionId: 's1' }),
        },
        subscription: { findMany: jest.fn().mockResolvedValue(subs) },
        subscriptionFreeze: { findMany: jest.fn().mockResolvedValue(freezes) },
    }
    return prisma
}

const run = (prisma: unknown, admin = true) =>
    new ListMemberSubscriptionsHandler(
        prisma as never,
        rbac(admin) as never,
    ).execute(
        new ListMemberSubscriptionsFeature('w1', 'u1', 'inv', 'admin', false),
    )

describe('ListMemberSubscriptionsHandler', () => {
    it('forbids a non-admin', async () => {
        await expect(run(build([subRow()]), false)).rejects.toThrow(
            /администратор/i,
        )
    })

    it('returns the usable pointer row as current', async () => {
        const out = await run(build([subRow()]))
        expect(out.current).toMatchObject({ id: 's1', planName: 'Monthly' })
        expect(out.history).toHaveLength(1)
    })

    it('returns current null when the pointed-at abonement has expired', async () => {
        const out = await run(
            build([subRow({ endDate: new Date('2026-07-31T00:00:00Z') })]),
        )
        expect(out.current).toBeNull()
        expect(out.history).toHaveLength(1)
    })

    it('serializes the member freezes, newest first from the query', async () => {
        const prisma = build([subRow()], [freezeRow()])
        const out = await run(prisma)
        expect(prisma.subscriptionFreeze.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
            orderBy: { fromDate: 'desc' },
        })
        expect(out.freezes).toEqual([
            {
                id: 'f1',
                subscriptionId: 's1',
                fromDate: '2026-10-24',
                untilDate: '2026-10-30',
                days: 7,
                reason: 'Травма',
                endedEarlyAt: null,
                createdAt: '2026-10-24T09:00:00.000Z',
            },
        ])
    })
})
