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

// The autopay agreements writer (domains/autopay): the hooks only call it.
const autopay = () => ({
    cancelForPlan: jest.fn().mockResolvedValue(0),
    notifyTermsChanged: jest.fn().mockResolvedValue(0),
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
            workspaceId: 'w1',
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

    it('deletes an unreferenced tariff, stopping any autopay left on it first', async () => {
        const prisma = {
            plan: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'p1', directions: [], _count: { subscriptions: 0 } }),
                delete: jest.fn().mockResolvedValue({}),
            },
        }
        const a = autopay()
        const out = await new DeletePlanHandler(
            prisma as never,
            rbac(true) as never,
            a as never,
        ).execute(new DeletePlanFeature('w1', 'p1', 'u1', 'admin', false))
        expect(out).toEqual({ status: 'deleted' })
        expect(a.cancelForPlan).toHaveBeenCalledWith(
            'p1',
            'клуб больше не продлевает этот тариф автоматически',
        )
        expect(a.cancelForPlan.mock.invocationCallOrder[0]).toBeLessThan(
            prisma.plan.delete.mock.invocationCallOrder[0],
        )
    })
})

// Autopay on a tariff (docs/design/2026-11-15-member-autopay.md §3.5): it
// needs online sale and the club's YooKassa autopay setting; turning it (or
// online sale, or the tariff) off stops the live agreements; less favourable
// terms notify the members.
describe('tariff autopay', () => {
    const stored = {
        id: 'p1',
        workspaceId: 'w1',
        name: 'Безлимит',
        description: null,
        price: 4000,
        currency: 'RUB',
        durationDays: 30,
        classCount: null,
        isFreeTrial: false,
        startsOnFirstVisit: false,
        isActive: true,
        purchasableOnline: true,
        autopayAvailable: true,
        directions: [],
        updatedAt: STORED_AT,
    }
    const db = (
        current: Partial<typeof stored> = {},
        settings: { provider: string; autopayEnabled: boolean } | null = {
            provider: 'YOOKASSA',
            autopayEnabled: true,
        },
    ) => {
        let row = { ...stored, ...current }
        let scope: string[] = []
        return withTx({
            workspacePaymentSettings: { findUnique: jest.fn().mockResolvedValue(settings) },
            direction: {
                findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
                    where.id.in.map((id) => ({ id })),
                ),
            },
            plan: {
                findFirst: jest.fn(async () => ({
                    ...row,
                    directions: scope.map((directionId) => ({ directionId })),
                })),
                create: jest.fn(async ({ data }: { data: Partial<typeof stored> }) => ({
                    ...stored,
                    ...data,
                    directions: [],
                })),
                // What the handler wrote is what it reads back.
                update: jest.fn(
                    async ({
                        data,
                    }: {
                        data: Partial<typeof stored> & {
                            directions?: { create: Array<{ directionId: string }> }
                        }
                    }) => {
                        const { directions, ...fields } = data
                        if (directions) scope = directions.create.map((c) => c.directionId)
                        row = { ...row, ...fields }
                        return {
                            ...row,
                            directions: scope.map((id) => ({
                                direction: { id, name: id, color: null, icon: null },
                            })),
                        }
                    },
                ),
            },
        })
    }
    const update = (
        prisma: ReturnType<typeof db>,
        payload: ConstructorParameters<typeof UpdatePlanFeature>[0],
        a = autopay(),
    ) =>
        new UpdatePlanHandler(prisma as never, rbac(true) as never, a as never).execute(
            new UpdatePlanFeature(payload, 'w1', 'p1', 'u1', 'admin', false),
        )
    const create = (
        prisma: ReturnType<typeof db>,
        extra: Partial<ConstructorParameters<typeof CreatePlanFeature>[0]>,
    ) =>
        new CreatePlanHandler(prisma as never, rbac(true) as never).execute(
            new CreatePlanFeature(
                { name: 'Безлимит', price: 4000, currency: 'RUB', durationDays: 30, ...extra },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )

    it('creates a tariff renewing by autopay only when sold online in a club offering it', async () => {
        await expect(create(db(), { autopayAvailable: true })).rejects.toThrow(
            'Продлевать автоплатежом можно только тариф, который покупают онлайн',
        )
        const off = db({}, { provider: 'YOOKASSA', autopayEnabled: false })
        await expect(
            create(off, { purchasableOnline: true, autopayAvailable: true }),
        ).rejects.toThrow('Включите автоплатежи в разделе «Онлайн-оплата»')
        const stripe = db({}, { provider: 'STRIPE', autopayEnabled: true })
        await expect(
            create(stripe, { purchasableOnline: true, autopayAvailable: true }),
        ).rejects.toThrow('Включите автоплатежи')
        expect(off.plan.create).not.toHaveBeenCalled()

        const on = db()
        const out = await create(on, { purchasableOnline: true, autopayAvailable: true })
        expect(on.plan.create.mock.calls[0][0].data.autopayAvailable).toBe(true)
        expect(out.autopayAvailable).toBe(true)
        await create(on, { purchasableOnline: true })
        expect(on.plan.create.mock.calls[1][0].data.autopayAvailable).toBe(false)
    })

    it('checks the club setting only when the box is ticked, not when a form re-sends it', async () => {
        const off = { provider: 'YOOKASSA', autopayEnabled: false }
        const unticked = db({ autopayAvailable: false }, off)
        await expect(update(unticked, { autopayAvailable: true })).rejects.toThrow(
            'Включите автоплатежи в разделе «Онлайн-оплата»',
        )
        expect(unticked.plan.update).not.toHaveBeenCalled()

        const ticked = db({}, off)
        await update(ticked, { autopayAvailable: true, name: 'Безлимит+' })
        expect(ticked.plan.update.mock.calls[0][0].data).toEqual({ name: 'Безлимит+' })

        const offline = db({ purchasableOnline: false, autopayAvailable: false })
        await expect(update(offline, { autopayAvailable: true })).rejects.toThrow(
            'только тариф, который покупают онлайн',
        )

        const fresh = db({ autopayAvailable: false })
        const out = await update(fresh, { autopayAvailable: true })
        expect(fresh.plan.update.mock.calls[0][0].data).toEqual({ autopayAvailable: true })
        expect(out.autopayAvailable).toBe(true)
    })

    it.each([
        ['autopay unticked', { autopayAvailable: false }],
        ['online sale turned off', { purchasableOnline: false }],
        ['archived', { isActive: false }],
    ])('stops the live agreements when %s', async (_case, payload) => {
        const prisma = db()
        const a = autopay()
        const out = await update(prisma, payload, a)
        expect(a.cancelForPlan).toHaveBeenCalledWith(
            'p1',
            'клуб больше не продлевает этот тариф автоматически',
        )
        expect(a.notifyTermsChanged).not.toHaveBeenCalled()
        if ('purchasableOnline' in payload) {
            // Autopay needs online sale: the box goes with it.
            expect(prisma.plan.update.mock.calls[0][0].data).toEqual({
                purchasableOnline: false,
                autopayAvailable: false,
            })
            expect(out.autopayAvailable).toBe(false)
        }
    })

    it.each([
        ['a price rise', { price: 4500 }],
        ['a shorter term', { durationDays: 28 }],
        ['a pack size', { classCount: 12 }],
    ])('tells the members about %s (the charge waits for their confirmation)', async (_case, payload) => {
        const a = autopay()
        await update(db(), payload, a)
        expect(a.notifyTermsChanged).toHaveBeenCalledWith('p1')
        expect(a.cancelForPlan).not.toHaveBeenCalled()
    })

    it('stays quiet on a price drop, a rename or a tariff without autopay', async () => {
        const a = autopay()
        await update(db(), { price: 3500 }, a)
        await update(db(), { name: 'Безлимит 2' }, a)
        await update(db({ autopayAvailable: false }), { price: 5000 }, a)
        expect(a.notifyTermsChanged).not.toHaveBeenCalled()
        expect(a.cancelForPlan).not.toHaveBeenCalled()
    })

    // Agreements renew abonements of the tariff's scope; a new scope would
    // leave them renewing something else (review P2-3): they stop.
    it('stops the live agreements when the directions change, not when they are re-sent', async () => {
        const a = autopay()
        await update(db(), { directionIds: [] }, a)
        expect(a.cancelForPlan).not.toHaveBeenCalled()
        await update(db(), { directionIds: ['d-bjj'] }, a)
        expect(a.cancelForPlan).toHaveBeenCalledWith('p1', 'тариф изменился')
        expect(a.notifyTermsChanged).not.toHaveBeenCalled()
        const off = autopay()
        await update(db({ autopayAvailable: false }), { directionIds: ['d-bjj'] }, off)
        expect(off.cancelForPlan).not.toHaveBeenCalled()
    })

    // Charged a day before the end and retried over 5 days (review P2-2).
    it('allows autopay only on a term of 7 days or more', async () => {
        const message = 'Продлевать автоплатежом можно тариф сроком от 7 дней'
        await expect(
            create(db(), { purchasableOnline: true, autopayAvailable: true, durationDays: 6 }),
        ).rejects.toThrow(message)
        await expect(update(db(), { durationDays: 5 })).rejects.toThrow(message)
        await expect(update(db({ autopayAvailable: false, durationDays: 3 }), { autopayAvailable: true })).rejects.toThrow(
            message,
        )
        // Unticking it with the shorter term in one save is fine.
        const prisma = db()
        await update(prisma, { durationDays: 5, autopayAvailable: false })
        expect(prisma.plan.update.mock.calls[0][0].data).toEqual({ durationDays: 5, autopayAvailable: false })
        await expect(
            create(db(), { purchasableOnline: true, autopayAvailable: true, durationDays: 7 }),
        ).resolves.toMatchObject({ autopayAvailable: true })
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
