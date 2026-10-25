import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListPlansFeature } from './list-plans.feature'
import { ListPlansHandler } from './list-plans.handler'

const planRow = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    workspaceId: 'w1',
    name: 'Monthly',
    description: null,
    price: 5000,
    currency: 'RUB',
    durationDays: 30,
    classCount: null,
    isFreeTrial: false,
    startsOnFirstVisit: false,
    isActive: true,
    ...over,
})

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const run = (
    prisma: unknown,
    admin: boolean,
    includeInactive?: boolean,
    resolver = rbac(admin),
) =>
    new ListPlansHandler(prisma as never, resolver as never).execute(
        new ListPlansFeature(
            { includeInactive },
            'w1',
            'u1',
            admin ? 'admin' : 'coach',
            false,
        ),
    )

describe('ListPlansHandler', () => {
    it('returns active plans only by default', async () => {
        const prisma = { plan: { findMany: jest.fn().mockResolvedValue([planRow()]) } }
        const out = await run(prisma, true)
        expect(prisma.plan.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isActive: true,
        })
        expect(out.data).toEqual([expect.objectContaining({ id: 'p1' })])
    })

    it('lets an admin include archived plans', async () => {
        const prisma = { plan: { findMany: jest.fn().mockResolvedValue([]) } }
        await run(prisma, true, true)
        expect(prisma.plan.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
        })
    })

    it('lets a coach read the sellable plans', async () => {
        const prisma = { plan: { findMany: jest.fn().mockResolvedValue([planRow()]) } }
        const out = await run(prisma, false)
        expect(out.data).toHaveLength(1)
    })

    it('ignores includeInactive for a coach', async () => {
        const prisma = { plan: { findMany: jest.fn().mockResolvedValue([]) } }
        await run(prisma, false, true)
        expect(prisma.plan.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isActive: true,
        })
    })

    it('refuses a caller with no staff scope', async () => {
        const resolver = {
            ...rbac(false),
            resolveCoachScope: jest
                .fn()
                .mockRejectedValue(new ForbiddenError({ message: 'Нужны права' })),
        }
        const prisma = { plan: { findMany: jest.fn() } }
        await expect(run(prisma, false, undefined, resolver)).rejects.toThrow(
            ForbiddenError,
        )
        expect(prisma.plan.findMany).not.toHaveBeenCalled()
    })
})
