import { CreatePlanFeature } from './create-plan.feature'
import { CreatePlanHandler } from './create-plan.handler'
import { DeletePlanFeature } from './delete-plan.feature'
import { DeletePlanHandler } from './delete-plan.handler'
import { UpdatePlanFeature } from './update-plan.feature'
import { UpdatePlanHandler } from './update-plan.handler'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
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
