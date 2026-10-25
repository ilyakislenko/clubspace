import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListPendingFreezeRequestsFeature } from './list-pending-freeze-requests.feature'
import { ListPendingFreezeRequestsHandler } from './list-pending-freeze-requests.handler'

const row = () => ({
    id: 'r1',
    subscriptionId: 's1',
    userId: 'm1',
    status: 'PENDING',
    fromDate: new Date('2026-10-28T00:00:00Z'),
    days: 7,
    reason: 'Травма',
    decisionComment: null,
    decidedAt: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
    user: { firstname: 'Анна', lastname: 'Ким', email: 'a@x' },
    subscription: { plan: { name: 'Месяц' } },
})

const build = (admin: boolean) => {
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({
            scope: admin ? 'admin' : 'coach_own_only',
            userId: 'inv',
        }),
        canWriteAllGroups: jest.fn().mockReturnValue(admin),
    }
    const prisma = {
        subscriptionFreezeRequest: {
            findMany: jest.fn().mockResolvedValue([row()]),
        },
    }
    const handler = new ListPendingFreezeRequestsHandler(
        prisma as never,
        rbac as never,
    )
    return { handler, prisma, rbac }
}

const feature = (roleName: string | null = 'admin') =>
    new ListPendingFreezeRequestsFeature('w1', 'inv', roleName, false)

const whereOf = (prisma: ReturnType<typeof build>['prisma']) =>
    prisma.subscriptionFreezeRequest.findMany.mock.calls[0][0]

describe('ListPendingFreezeRequestsHandler', () => {
    it('propagates the scope refusal for a plain member', async () => {
        const { handler, rbac } = build(true)
        rbac.resolveCoachScope.mockRejectedValue(
            new ForbiddenError({ message: 'Нужны права администратора клуба' }),
        )
        await expect(handler.execute(feature('user'))).rejects.toThrow(
            /Нужны права/,
        )
    })

    it('lists the whole club for an admin, with only live abonements', async () => {
        const { handler, prisma } = build(true)
        const out = await handler.execute(feature())
        const { where, orderBy, take } = whereOf(prisma)
        expect(where).toEqual({
            workspaceId: 'w1',
            status: 'PENDING',
            subscription: {
                status: 'ACTIVE',
                OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
                members: { some: { status: 'ACTIVE' } },
            },
        })
        expect(orderBy).toEqual({ createdAt: 'asc' })
        expect(take).toBe(100)
        expect(out.data).toEqual([
            expect.objectContaining({
                id: 'r1',
                memberName: 'Анна Ким',
                planName: 'Месяц',
                untilDate: '2026-11-03',
            }),
        ])
    })

    it('narrows a coach to members of their groups, never themselves', async () => {
        const { handler, prisma } = build(false)
        await handler.execute(feature('coach'))
        const { where } = whereOf(prisma)
        expect(where.userId).toEqual({ not: 'inv' })
        expect(where.user).toEqual({
            groupMemberships: {
                some: {
                    group: {
                        workspaceId: 'w1',
                        coaches: { some: { userId: 'inv' } },
                    },
                },
            },
        })
        expect(where.subscription.members).toEqual({
            some: { status: 'ACTIVE' },
        })
    })
})
