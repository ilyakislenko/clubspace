import {
    ForbiddenError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import { CreatePlanFeature } from './create-plan.feature'
import { CreatePlanHandler } from './create-plan.handler'
import { DeletePlanFeature } from './delete-plan.feature'
import { DeletePlanHandler } from './delete-plan.handler'
import { UpdatePlanFeature } from './update-plan.feature'
import { UpdatePlanHandler } from './update-plan.handler'

// The tier is decided by the role name and ownership the controller hands
// over (assertClubAdmin); `admin` only sets the resolved scope.
const rbac = (admin = true) => ({
    resolveCoachScope: jest.fn(async (p: { userId: string }) => ({
        scope: admin ? 'admin' : 'coach_own_only',
        userId: p.userId,
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    })),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

// The tariff's current version in the mocked database.
const STORED_AT = new Date('2026-11-14T10:00:00.000Z')

// Interactive transactions run against the same fake.
const withTx = <T extends object>(prisma: T) =>
    Object.assign(prisma, {
        $transaction: jest.fn(async (fn: (tx: T) => unknown) => fn(prisma)),
    })

describe('createPlan', () => {
    it('creates when admin (currency upper-cased)', async () => {
        const prisma = {
            plan: {
                create: jest.fn().mockResolvedValue({
                    id: 'p1',
                    workspaceId: 'w1',
                    name: 'Monthly',
                    description: null,
                    price: 5000,
                    currency: 'RUB',
                    durationDays: 30,
                    isActive: true,
                    directions: [],
                    updatedAt: STORED_AT,
                }),
            },
        }
        const out = await new CreatePlanHandler(
            prisma as never,
            rbac(true) as never,
        ).execute(
            new CreatePlanFeature(
                { name: 'Monthly', price: 5000, currency: 'rub', durationDays: 30 },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(prisma.plan.create.mock.calls[0][0].data.currency).toBe('RUB')
        expect(out).toMatchObject({ id: 'p1', durationDays: 30, isActive: true })
    })

    it('stores startsOnFirstVisit, defaulting to false', async () => {
        const row = {
            id: 'p1',
            workspaceId: 'w1',
            name: 'Monthly',
            description: null,
            price: 5000,
            currency: 'RUB',
            durationDays: 30,
            classCount: null,
            isFreeTrial: false,
            startsOnFirstVisit: true,
            isActive: true,
            directions: [],
            updatedAt: STORED_AT,
        }
        const prisma = { plan: { create: jest.fn().mockResolvedValue(row) } }
        const create = (startsOnFirstVisit?: boolean) =>
            new CreatePlanHandler(prisma as never, rbac(true) as never).execute(
                new CreatePlanFeature(
                    {
                        name: 'Monthly',
                        price: 5000,
                        currency: 'RUB',
                        durationDays: 30,
                        startsOnFirstVisit,
                    },
                    'w1',
                    'u1',
                    'admin',
                    false,
                ),
            )
        const out = await create(true)
        expect(prisma.plan.create.mock.calls[0][0].data.startsOnFirstVisit).toBe(
            true,
        )
        expect(out.startsOnFirstVisit).toBe(true)
        await create()
        expect(prisma.plan.create.mock.calls[1][0].data.startsOnFirstVisit).toBe(
            false,
        )
    })

    it('forbids a non-admin', async () => {
        const prisma = { plan: { create: jest.fn() } }
        await expect(
            new CreatePlanHandler(prisma as never, rbac(false) as never).execute(
                new CreatePlanFeature(
                    { name: 'x', price: 0, currency: 'RUB', durationDays: 30 },
                    'w1',
                    'u1',
                    'coach',
                    false,
                ),
            ),
        ).rejects.toThrow(/администратор/i)
        expect(prisma.plan.create).not.toHaveBeenCalled()
    })

    it('stores the scope (duplicates collapsed) in the same write and returns it', async () => {
        const bjj = { id: 'd1', name: 'БЖЖ', color: null, icon: null }
        const prisma = {
            direction: {
                findMany: jest.fn().mockResolvedValue([{ id: 'd1' }, { id: 'd2' }]),
            },
            plan: {
                create: jest.fn().mockResolvedValue({
                    id: 'p1',
                    workspaceId: 'w1',
                    name: 'БЖЖ 12',
                    description: null,
                    price: 6000,
                    currency: 'RUB',
                    durationDays: 30,
                    classCount: 12,
                    isFreeTrial: false,
                    startsOnFirstVisit: false,
                    isActive: true,
                    purchasableOnline: false,
                    directions: [{ direction: bjj }],
                    updatedAt: STORED_AT,
                }),
            },
        }
        const out = await new CreatePlanHandler(
            prisma as never,
            rbac(true) as never,
        ).execute(
            new CreatePlanFeature(
                {
                    name: 'БЖЖ 12',
                    price: 6000,
                    currency: 'RUB',
                    durationDays: 30,
                    directionIds: ['d1', 'd2', 'd1'],
                },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(prisma.direction.findMany.mock.calls[0][0].where).toEqual({
            id: { in: ['d1', 'd2'] },
            workspaceId: 'w1',
        })
        const call = prisma.plan.create.mock.calls[0][0]
        expect(call.data.directions).toEqual({
            create: [{ directionId: 'd1' }, { directionId: 'd2' }],
        })
        expect(call.include.directions).toBeDefined()
        expect(out.directions).toEqual([bjj])
    })

    it('404s a direction of another club and creates nothing', async () => {
        const prisma = {
            direction: { findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]) },
            plan: { create: jest.fn() },
        }
        await expect(
            new CreatePlanHandler(prisma as never, rbac(true) as never).execute(
                new CreatePlanFeature(
                    {
                        name: 'x',
                        price: 0,
                        currency: 'RUB',
                        durationDays: 30,
                        directionIds: ['d1', 'foreign'],
                    },
                    'w1',
                    'u1',
                    'admin',
                    false,
                ),
            ),
        ).rejects.toThrow('Направление не найдено')
        expect(prisma.plan.create).not.toHaveBeenCalled()
    })
})

describe('updatePlan', () => {
    it('changes startsOnFirstVisit only when it is sent', async () => {
        const prisma = withTx({
            plan: {
                findFirst: jest.fn().mockResolvedValue({ id: 'p1', directions: [] }),
                update: jest.fn().mockResolvedValue({
                    id: 'p1',
                    workspaceId: 'w1',
                    name: 'Monthly',
                    description: null,
                    price: 5000,
                    currency: 'RUB',
                    durationDays: 30,
                    classCount: null,
                    isFreeTrial: false,
                    startsOnFirstVisit: true,
                    isActive: true,
                    directions: [],
                    updatedAt: STORED_AT,
                }),
            },
        })
        const update = (payload: { startsOnFirstVisit?: boolean; name?: string }) =>
            new UpdatePlanHandler(prisma as never, rbac(true) as never).execute(
                new UpdatePlanFeature(payload, 'w1', 'p1', 'u1', 'admin', false),
            )
        const out = await update({ startsOnFirstVisit: true })
        expect(prisma.plan.update.mock.calls[0][0].data).toEqual({
            startsOnFirstVisit: true,
        })
        expect(out.startsOnFirstVisit).toBe(true)
        await update({ name: 'x' })
        expect(prisma.plan.update.mock.calls[1][0].data).toEqual({ name: 'x' })
    })

    const updatable = () =>
        withTx({
            direction: { findMany: jest.fn().mockResolvedValue([{ id: 'd2' }]) },
            plan: {
                findFirst: jest.fn().mockResolvedValue({ id: 'p1', directions: [] }),
                // The compare-and-set: matches only the stored version.
                updateMany: jest.fn(
                    async (args: { where: { updatedAt: Date } }) => ({
                        count:
                            args.where.updatedAt.getTime() === STORED_AT.getTime()
                                ? 1
                                : 0,
                    }),
                ),
                update: jest.fn().mockResolvedValue({
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
                    purchasableOnline: false,
                    directions: [],
                    updatedAt: new Date('2026-11-14T11:00:00.000Z'),
                }),
            },
        })

    const rename = (
        prisma: ReturnType<typeof updatable>,
        expectedUpdatedAt?: string,
    ) =>
        new UpdatePlanHandler(prisma as never, rbac(true) as never).execute(
            new UpdatePlanFeature(
                { name: 'Безлимит', expectedUpdatedAt },
                'w1',
                'p1',
                'u1',
                'admin',
                false,
            ),
        )

    it('refuses a form that read an older version with 409, writing nothing', async () => {
        const prisma = updatable()
        const err = await rename(prisma, '2026-11-14T09:00:00.000Z').catch(
            (e: unknown) => e,
        )
        expect(err).toBeInstanceOf(StaleUpdateError)
        expect((err as StaleUpdateError).statusCode).toBe(409)
        expect(prisma.plan.update).not.toHaveBeenCalled()
    })

    it('saves a form that read the current version and returns the new one', async () => {
        const prisma = updatable()
        const out = await rename(prisma, STORED_AT.toISOString())
        expect(prisma.plan.updateMany.mock.calls[0][0].where).toEqual({
            id: 'p1',
            updatedAt: STORED_AT,
        })
        expect(prisma.plan.update.mock.calls[0][0].data).toEqual({ name: 'Безлимит' })
        expect(out.updatedAt).toBe('2026-11-14T11:00:00.000Z')
    })

    it('keeps last-write-wins when the version is omitted', async () => {
        const prisma = updatable()
        await rename(prisma)
        expect(prisma.plan.updateMany).not.toHaveBeenCalled()
        expect(prisma.plan.update).toHaveBeenCalled()
    })

    it('replaces the whole scope in the same write when directionIds is sent', async () => {
        const prisma = updatable()
        await new UpdatePlanHandler(prisma as never, rbac(true) as never).execute(
            new UpdatePlanFeature({ directionIds: ['d2'] }, 'w1', 'p1', 'u1', 'admin', false),
        )
        expect(prisma.plan.update.mock.calls[0][0].data).toEqual({
            directions: { deleteMany: {}, create: [{ directionId: 'd2' }] },
        })
    })

    it('404s a foreign direction and leaves the tariff untouched', async () => {
        const prisma = updatable()
        prisma.direction.findMany.mockResolvedValue([])
        await expect(
            new UpdatePlanHandler(prisma as never, rbac(true) as never).execute(
                new UpdatePlanFeature(
                    { directionIds: ['foreign'] },
                    'w1',
                    'p1',
                    'u1',
                    'admin',
                    false,
                ),
            ),
        ).rejects.toThrow('Направление не найдено')
        expect(prisma.plan.update).not.toHaveBeenCalled()
    })

    it('never touches sold abonements (they keep their snapshot)', async () => {
        const prisma = { ...updatable(), subscription: { updateMany: jest.fn() } }
        await new UpdatePlanHandler(prisma as never, rbac(true) as never).execute(
            new UpdatePlanFeature({ directionIds: [] }, 'w1', 'p1', 'u1', 'admin', false),
        )
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
        expect(prisma.plan.update.mock.calls[0][0].data).toEqual({
            directions: { deleteMany: {}, create: [] },
        })
    })

    it('404s an unknown tariff', async () => {
        const prisma = updatable()
        prisma.plan.findFirst.mockResolvedValue(null)
        await expect(
            new UpdatePlanHandler(prisma as never, rbac(true) as never).execute(
                new UpdatePlanFeature({ name: 'x' }, 'w1', 'p1', 'u1', 'admin', false),
            ),
        ).rejects.toThrow('Тариф не найден')
    })
})

describe('deletePlan', () => {
    it('blocks delete when the tariff has subscriptions', async () => {
        const prisma = {
            plan: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'p1', directions: [], _count: { subscriptions: 3 } }),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeletePlanHandler(prisma as never, rbac(true) as never).execute(
                new DeletePlanFeature('w1', 'p1', 'u1', 'admin', false),
            ),
        ).rejects.toThrow(/архив/i)
        expect(prisma.plan.delete).not.toHaveBeenCalled()
    })

    it('deletes an unreferenced tariff', async () => {
        const prisma = {
            plan: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'p1', directions: [], _count: { subscriptions: 0 } }),
                delete: jest.fn().mockResolvedValue({}),
            },
        }
        const out = await new DeletePlanHandler(
            prisma as never,
            rbac(true) as never,
        ).execute(new DeletePlanFeature('w1', 'p1', 'u1', 'admin', false))
        expect(out).toEqual({ status: 'deleted' })
    })
})

// Tariffs and prices are club money: a head coach (and a direction manager,
// who is a coach) is refused every write; the owner passes whatever their row.
describe('plan writes by tier', () => {
    const planRow = {
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
        purchasableOnline: false,
        directions: [],
        updatedAt: STORED_AT,
    }
    const prisma = () =>
        withTx({
            plan: {
                create: jest.fn().mockResolvedValue(planRow),
                findFirst: jest.fn().mockResolvedValue({ ...planRow, _count: { subscriptions: 0 } }),
                update: jest.fn().mockResolvedValue(planRow),
                delete: jest.fn().mockResolvedValue({}),
            },
        })
    const create = (role: string, userId = 'u1') =>
        new CreatePlanFeature(
            { name: 'x', price: 100, currency: 'RUB', durationDays: 30 },
            'w1',
            userId,
            role,
            false,
        )

    it.each(['head_coach', 'coach'])('refuses a %s create, update and delete', async (role) => {
        const p = prisma()
        const r = rbac(role === 'head_coach')
        await expect(
            new CreatePlanHandler(p as never, r as never).execute(create(role)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            new UpdatePlanHandler(p as never, r as never).execute(
                new UpdatePlanFeature({ price: 1 }, 'w1', 'p1', 'u1', role, false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            new DeletePlanHandler(p as never, r as never).execute(
                new DeletePlanFeature('w1', 'p1', 'u1', role, false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.plan.findFirst).not.toHaveBeenCalled()
        expect(p.plan.create).not.toHaveBeenCalled()
        expect(p.plan.update).not.toHaveBeenCalled()
        expect(p.plan.delete).not.toHaveBeenCalled()
    })

    it('lets the owner create even with a head-coach member row', async () => {
        const p = prisma()
        await new CreatePlanHandler(p as never, rbac(true) as never).execute(
            create('head_coach', 'owner'),
        )
        expect(p.plan.create).toHaveBeenCalled()
    })
})
