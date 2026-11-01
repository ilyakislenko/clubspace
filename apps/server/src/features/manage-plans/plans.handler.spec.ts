import { ForbiddenError } from '../../shared/errors/shared.errors'
import { CreatePlanFeature } from './create-plan.feature'
import { CreatePlanHandler } from './create-plan.handler'
import { DeletePlanFeature } from './delete-plan.feature'
import { DeletePlanHandler } from './delete-plan.handler'
import { UpdatePlanFeature } from './update-plan.feature'
import { UpdatePlanHandler } from './update-plan.handler'

const rbac = (admin = true, managed: string[] = []) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
    // Mirrors RbacService: admin passes; else every named direction must be
    // managed, null (club-wide) or nothing named is refused.
    assertCanManageDirection: jest.fn(
        async (_ctx: unknown, ...ids: Array<string | null | undefined>) => {
            if (admin) return
            const named = ids.filter((d) => d !== undefined)
            if (
                named.length === 0 ||
                named.some((d) => d === null || !managed.includes(d))
            ) {
                throw new ForbiddenError({
                    message: 'Нужны права администратора клуба',
                })
            }
        },
    ),
    assertManagesDirections: jest.fn(async () => {
        if (admin) return null
        if (managed.length === 0) {
            throw new ForbiddenError({
                message: 'Нужны права администратора клуба',
            })
        }
        return managed
    }),
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
})

describe('updatePlan', () => {
    it('changes startsOnFirstVisit only when it is sent', async () => {
        const prisma = {
            plan: {
                findFirst: jest.fn().mockResolvedValue({ id: 'p1' }),
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
                }),
            },
        }
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
})

describe('deletePlan', () => {
    it('blocks delete when the tariff has subscriptions', async () => {
        const prisma = {
            plan: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'p1', _count: { subscriptions: 3 } }),
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
                    .mockResolvedValue({ id: 'p1', _count: { subscriptions: 0 } }),
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

describe('plans as a direction manager', () => {
    const BJJ = '11111111-1111-4111-8111-111111111111'
    const MMA = '22222222-2222-4222-8222-222222222222'
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
        directionId: BJJ,
    }

    it('creates a tariff in a managed direction; refuses another or club-wide', async () => {
        const prisma = {
            plan: { create: jest.fn().mockResolvedValue(planRow) },
            direction: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
        }
        const r = rbac(false, [BJJ])
        const handler = new CreatePlanHandler(prisma as never, r as never)
        const f = (directionId?: string) =>
            new CreatePlanFeature(
                { name: 'x', price: 0, currency: 'RUB', durationDays: 30, directionId },
                'w1',
                'u1',
                'coach',
                false,
            )
        await handler.execute(f(BJJ))
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            BJJ,
        )
        await expect(handler.execute(f(MMA))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        await expect(handler.execute(f())).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.plan.create).toHaveBeenCalledTimes(1)
    })

    it('update passes current + target; refuses moving to club-wide', async () => {
        const prisma = {
            plan: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'p1',
                    price: 5000,
                    isFreeTrial: false,
                    purchasableOnline: false,
                    directionId: BJJ,
                }),
                update: jest.fn().mockResolvedValue(planRow),
            },
            direction: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
        }
        const r = rbac(false, [BJJ])
        const handler = new UpdatePlanHandler(prisma as never, r as never)
        await handler.execute(
            new UpdatePlanFeature({ name: 'y' }, 'w1', 'p1', 'u1', 'coach', false),
        )
        await expect(
            handler.execute(
                new UpdatePlanFeature(
                    { directionId: MMA },
                    'w1',
                    'p1',
                    'u1',
                    'coach',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            BJJ,
            MMA,
        )
        await expect(
            handler.execute(
                new UpdatePlanFeature(
                    { directionId: null },
                    'w1',
                    'p1',
                    'u1',
                    'coach',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.plan.update).toHaveBeenCalledTimes(1)
    })

    it('refuses deleting another direction tariff', async () => {
        const prisma = {
            plan: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'p1',
                    directionId: MMA,
                    _count: { subscriptions: 0 },
                }),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeletePlanHandler(
                prisma as never,
                rbac(false, [BJJ]) as never,
            ).execute(new DeletePlanFeature('w1', 'p1', 'u1', 'coach', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.plan.delete).not.toHaveBeenCalled()
    })
})
