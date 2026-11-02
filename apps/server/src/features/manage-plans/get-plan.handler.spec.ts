import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetPlanFeature } from './get-plan.feature'
import { GetPlanHandler } from './get-plan.handler'

const PLAN = '11111111-1111-4111-8111-111111111111'
const BJJ = { id: 'd-bjj', name: 'БЖЖ', color: '#000000' }

const planRow = (directions: Array<typeof BJJ>) => ({
    id: PLAN,
    workspaceId: 'w1',
    name: '12 занятий',
    description: null,
    price: 5000,
    currency: 'RUB',
    durationDays: 30,
    classCount: 12,
    isFreeTrial: false,
    startsOnFirstVisit: true,
    isActive: true,
    purchasableOnline: true,
    directions: directions.map((direction) => ({ direction })),
})

const make = (opts: {
    scope: 'admin' | 'coach_own_only' | 'coach_read_all'
    plan: object | null
    managed?: string[]
}) => {
    const prisma = {
        plan: { findFirst: jest.fn().mockResolvedValue(opts.plan) },
        directionManager: {
            count: jest.fn(
                async (a: { where: { directionId: { in: string[] } } }) =>
                    a.where.directionId.in.filter((d) =>
                        (opts.managed ?? []).includes(d),
                    ).length,
            ),
        },
        subscription: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 's1',
                    startDate: new Date('2026-10-20T00:00:00Z'),
                    endDate: new Date('2026-11-19T00:00:00Z'),
                    durationDays: 30,
                    createdAt: new Date('2026-10-18T09:00:00Z'),
                    classesTotal: 12,
                    classesRemaining: 7,
                    isPaid: false,
                    workspaceMember: {
                        userId: 'u-ivan',
                        user: { firstname: 'Иван', lastname: 'Петров', email: null },
                    },
                },
            ]),
            count: jest.fn().mockResolvedValue(4),
            aggregate: jest.fn().mockResolvedValue({ _sum: { amountPaid: 15000 } }),
        },
    }
    const rbac = new RbacService(prisma as never)
    jest.spyOn(rbac, 'resolveCoachScope').mockImplementation(async (p) => ({
        scope: opts.scope,
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: 'owner',
    }))
    const run = (planId = PLAN) =>
        new GetPlanHandler(prisma as never, rbac).execute(
            new GetPlanFeature('w1', planId, 'me', 'coach', false),
        )
    return { prisma, run }
}

describe('GetPlanHandler', () => {
    it('returns the tariff, its holders and the last 30 days to admin scope', async () => {
        const { prisma, run } = make({ scope: 'admin', plan: planRow([]) })
        const out = await run()
        expect(out.plan).toMatchObject({ id: PLAN, startsOnFirstVisit: true, directions: [] })
        expect(out.holders).toEqual([
            expect.objectContaining({
                subscriptionId: 's1',
                userId: 'u-ivan',
                firstname: 'Иван',
                classesRemaining: 7,
                isPaid: false,
                endDate: '2026-11-19T00:00:00.000Z',
            }),
        ])
        expect(out.last30Days).toEqual({ sold: 4, revenue: 15000 })
        // Current abonements of members only; revenue in the tariff's currency.
        const held = prisma.subscription.findMany.mock.calls[0][0].where
        expect(held).toMatchObject({ workspaceId: 'w1', planId: PLAN, status: 'ACTIVE' })
        expect(held.NOT).toEqual({ workspaceMemberId: null })
        const paid = prisma.subscription.aggregate.mock.calls[0][0].where
        expect(paid).toMatchObject({ planId: PLAN, currency: 'RUB', isPaid: true })
        expect(prisma.subscription.count.mock.calls[0][0].where.status).toEqual({
            not: 'CANCELLED',
        })
    })

    it('lets a direction manager open a tariff of their direction', async () => {
        const { run } = make({
            scope: 'coach_own_only',
            plan: planRow([BJJ]),
            managed: ['d-bjj'],
        })
        await expect(run()).resolves.toMatchObject({ plan: { id: PLAN } })
    })

    it('refuses a direction manager a tariff of another direction', async () => {
        const { prisma, run } = make({
            scope: 'coach_own_only',
            plan: planRow([BJJ]),
            managed: ['d-mma'],
        })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('keeps a club-wide tariff to admin scope', async () => {
        const { run } = make({
            scope: 'coach_read_all',
            plan: planRow([]),
            managed: ['d-bjj'],
        })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('is a 404 for a tariff of another club or a malformed id', async () => {
        const { prisma, run } = make({ scope: 'admin', plan: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.plan.findFirst.mock.calls[0][0].where).toEqual({
            id: PLAN,
            workspaceId: 'w1',
        })
        await expect(run('not-a-uuid')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.plan.findFirst).toHaveBeenCalledTimes(1)
    })
})
