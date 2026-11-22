jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../online-payments/load-buyer', () => ({ PENDING_REUSE_MS: 30 * 60 * 1000 }))

import { ForbiddenError, StaleUpdateError } from '../../shared/errors/shared.errors'
import { CreateDiscountFeature, CreateDiscountInputSchema } from './create-discount.feature'
import { CreateDiscountHandler } from './create-discount.handler'
import { DeleteDiscountFeature } from './delete-discount.feature'
import { DeleteDiscountHandler } from './delete-discount.handler'
import { summarizeStaffDiscounts } from './discount-staff-summary'
import { ListDiscountsFeature, ListDiscountsInputSchema } from './list-discounts.feature'
import { ListDiscountsHandler } from './list-discounts.handler'
import { UpdateDiscountFeature } from './update-discount.feature'
import { UpdateDiscountHandler } from './update-discount.handler'

const OWNER = 'owner'
const rbac = () => ({
    resolveCoachScope: jest.fn(async ({ userId }: { userId: string }) => ({
        userId,
        workspaceOwnerId: OWNER,
    })),
    clubVocabulary: jest.fn(),
})

const dto = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    name: 'Студенческая',
    kind: 'PERCENT',
    value: 15,
    currency: null,
    code: null,
    isFamily: false,
    allPlans: true,
    events: false,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    oncePerMember: false,
    isActive: true,
    plans: [] as Array<{ planId: string; plan: { name: string } }>,
    createdAt: new Date('2027-03-01T00:00:00Z'),
    updatedAt: new Date('2027-03-01T00:00:00Z'),
    ...over,
})

const prismaMock = () => {
    const p = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }) },
        discount: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => dto({ ...data, plans: [] })),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            delete: jest.fn().mockResolvedValue({}),
        },
        plan: { count: jest.fn().mockResolvedValue(0) },
        subscription: {
            count: jest.fn().mockResolvedValue(0),
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        eventRegistration: {
            count: jest.fn().mockResolvedValue(0),
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        payment: { count: jest.fn().mockResolvedValue(0) },
        user: { findMany: jest.fn().mockResolvedValue([]) },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(p)),
    }
    return p
}
const services = () => ({
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    realtime: { invalidate: jest.fn() },
})

const STAFF_ROLES_REFUSED = ['head_coach', 'coach', 'direction_manager']
const base = { name: 'Студенческая', kind: 'PERCENT' as const, value: 15 }

describe('CreateDiscountInputSchema (superRefine)', () => {
    const issue = (p: Record<string, unknown>) => {
        const r = CreateDiscountInputSchema.safeParse({ ...base, ...p })
        return r.success ? null : r.error.issues[0].message
    }
    it.each([
        [{ value: 101 }, 'Процент скидки — от 1 до 100'],
        [{ currency: 'RUB' }, 'У скидки в процентах нет валюты'],
        [{ kind: 'FIXED', value: 500 }, 'Укажите валюту скидки'],
        [{ code: 'a!' }, 'Промокод — от 3 до 32 букв, цифр или дефисов'],
        [{ isFamily: true, code: 'СЕМЬЯ' }, 'Семейная скидка применяется сама — без промокода и ограничений'],
        [{ isFamily: true, maxUses: 5 }, 'Семейная скидка применяется сама — без промокода и ограничений'],
        [{ isFamily: true, oncePerMember: true }, 'Семейная скидка применяется сама — без промокода и ограничений'],
        [{ allPlans: false }, 'Выберите, на что действует скидка'],
        [{ startsOn: '2027-03-10', endsOn: '2027-03-01' }, 'Дата окончания раньше даты начала'],
    ])('%j → %s', (p, message) => {
        expect(issue(p)).toBe(message)
    })

    it('accepts a fixed sum with its currency, events only, a code', () => {
        expect(issue({ kind: 'FIXED', value: 500, currency: 'RUB' })).toBeNull()
        expect(issue({ allPlans: false, events: true })).toBeNull()
        expect(issue({ code: 'весна' })).toBeNull()
        expect(issue({ value: 100 })).toBeNull()
    })
})

describe('CreateDiscountHandler', () => {
    const run = (p: ReturnType<typeof prismaMock>, payload: Record<string, unknown>, role: string | null = 'admin', invoker = 'inv') => {
        const s = services()
        const out = new CreateDiscountHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new CreateDiscountFeature(CreateDiscountInputSchema.parse({ ...base, ...payload }), 'w1', invoker, role, false),
        )
        return { out, ...s }
    }

    it.each(STAFF_ROLES_REFUSED)('refuses a %s', async (role) => {
        const p = prismaMock()
        await expect(run(p, {}, role).out).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.discount.create).not.toHaveBeenCalled()
    })

    it('lets the owner (no member row) create, normalizes the code, audits and signals', async () => {
        const p = prismaMock()
        const { out, audit, realtime } = run(p, { code: ' весна ', endsOn: '2027-03-31' }, null, OWNER)
        const res = await out
        const data = p.discount.create.mock.calls[0][0].data
        expect(data).toMatchObject({ workspaceId: 'w1', code: 'ВЕСНА', createdById: OWNER, currency: null })
        expect(data.endsOn).toEqual(new Date('2027-03-31T00:00:00Z'))
        expect(res).toMatchObject({ name: 'Студенческая', code: 'ВЕСНА', status: 'active', uses: 0, given: [], endsOn: '2027-03-31' })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'discount.create', targetType: 'discount', actorId: OWNER, metadata: expect.objectContaining({ code: 'ВЕСНА' }) }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['discounts'])
    })

    it('refuses a taken name among active discounts and a second active family discount', async () => {
        const p = prismaMock()
        p.discount.findFirst.mockResolvedValueOnce({ id: 'other' })
        await expect(run(p, {}).out).rejects.toThrow('Скидка с таким названием уже есть')
        const q = prismaMock()
        q.discount.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
            where.isFamily ? { name: 'Семейная' } : null,
        )
        await expect(run(q, { name: 'Семья', isFamily: true }).out).rejects.toThrow('В клубе уже есть семейная скидка «Семейная»')
        expect(q.discount.findFirst.mock.calls[1][0].where).toEqual({ workspaceId: 'w1', isActive: true, isFamily: true })
    })

    it('turns a taken code (P2002) into a typed 400', async () => {
        const p = prismaMock()
        p.discount.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
        await expect(run(p, { code: 'ВЕСНА' }).out).rejects.toThrow('Такой промокод уже есть')
    })

    it('scopes to the club’s tariffs; a foreign tariff is a 404', async () => {
        const p = prismaMock()
        p.plan.count.mockResolvedValue(1)
        await expect(run(p, { allPlans: false, planIds: [UUID1, UUID2] }).out).rejects.toThrow('Тариф не найден')
        const q = prismaMock()
        q.plan.count.mockResolvedValue(2)
        await run(q, { allPlans: false, planIds: [UUID1, UUID2, UUID1] }).out
        expect(q.discount.create.mock.calls[0][0].data.plans).toEqual({ create: [{ planId: UUID1 }, { planId: UUID2 }] })
    })
})

const UUID1 = '11111111-1111-4111-8111-111111111111'
const UUID2 = '22222222-2222-4222-8222-222222222222'

describe('UpdateDiscountHandler', () => {
    const run = (p: ReturnType<typeof prismaMock>, payload: Record<string, unknown>, role: string | null = 'admin') => {
        const s = services()
        const out = new UpdateDiscountHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new UpdateDiscountFeature(payload as never, 'w1', 'd1', 'inv', role, false),
        )
        return { out, ...s }
    }
    const withExisting = (existing = dto()) => {
        const p = prismaMock()
        p.discount.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
            where.id === 'd1' ? existing : null,
        )
        p.discount.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
            dto({ ...existing, ...data, plans: existing.plans }),
        )
        return p
    }

    it.each(STAFF_ROLES_REFUSED)('refuses a %s', async (role) => {
        const p = withExisting()
        await expect(run(p, { value: 20 }, role).out).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.discount.update).not.toHaveBeenCalled()
    })

    it('404s a discount of another club', async () => {
        const p = prismaMock()
        await expect(run(p, { value: 20 }).out).rejects.toThrow('Скидка не найдена')
    })

    it('records the changed fields before → after', async () => {
        const p = withExisting()
        const { out, audit } = run(p, { value: 20 })
        expect(await out).toMatchObject({ value: 20 })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'discount.update',
                metadata: { name: 'Студенческая', changes: { value: { from: 15, to: 20 } } },
            }),
        )
    })

    it('checks the merged row (a percent above 100) and drops the currency when switching to a percent', async () => {
        await expect(run(withExisting(), { value: 150 }).out).rejects.toThrow('Процент скидки — от 1 до 100')
        const fixed = withExisting(dto({ kind: 'FIXED', value: 500, currency: 'RUB' }))
        await run(fixed, { kind: 'PERCENT', value: 10 }).out
        expect(fixed.discount.update.mock.calls[0][0].data).toMatchObject({ kind: 'PERCENT', currency: null })
    })

    it('a stale form is refused (409)', async () => {
        const p = withExisting()
        p.discount.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(p, { value: 20, expectedUpdatedAt: '2027-01-01T00:00:00.000Z' }).out).rejects.toBeInstanceOf(
            StaleUpdateError,
        )
        expect(p.discount.update).not.toHaveBeenCalled()
    })

    it('archives and restores; a restore re-runs the family check', async () => {
        const p = withExisting()
        const archived = run(p, { isActive: false })
        await archived.out
        expect(archived.audit.record.mock.calls[0][0].action).toBe('discount.archive')

        const family = withExisting(dto({ isActive: false, isFamily: true, name: 'Семейная' }))
        family.discount.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
            where.id === 'd1'
                ? dto({ isActive: false, isFamily: true, name: 'Семейная' })
                : where.isFamily
                  ? { name: 'Семья-2' }
                  : null,
        )
        await expect(run(family, { isActive: true }).out).rejects.toThrow('В клубе уже есть семейная скидка «Семья-2»')

        const ok = withExisting(dto({ isActive: false }))
        const restored = run(ok, { isActive: true })
        await restored.out
        expect(restored.audit.record.mock.calls[0][0].action).toBe('discount.restore')
    })

    it('turns a taken code into a typed 400', async () => {
        const p = withExisting()
        p.discount.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
        await expect(run(p, { code: 'ВЕСНА' }).out).rejects.toThrow('Такой промокод уже есть')
    })
})

describe('DeleteDiscountHandler', () => {
    const run = (p: ReturnType<typeof prismaMock>, role: string | null = 'admin') => {
        const s = services()
        const out = new DeleteDiscountHandler(p as never, rbac() as never, s.audit as never, s.realtime as never).execute(
            new DeleteDiscountFeature('w1', 'd1', 'inv', role, false),
        )
        return { out, ...s }
    }

    it.each(STAFF_ROLES_REFUSED)('refuses a %s', async (role) => {
        const p = prismaMock()
        p.discount.findFirst.mockResolvedValue(dto())
        await expect(run(p, role).out).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.discount.delete).not.toHaveBeenCalled()
    })

    it('404s an unknown discount', async () => {
        await expect(run(prismaMock()).out).rejects.toThrow('Скидка не найдена')
    })

    it('deletes an unused one and audits a snapshot', async () => {
        const p = prismaMock()
        p.discount.findFirst.mockResolvedValue(dto())
        const { out, audit } = run(p)
        expect(await out).toEqual({ status: 'deleted' })
        expect(p.discount.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'discount.delete', metadata: expect.objectContaining({ name: 'Студенческая' }) }),
        )
    })

    it.each(['subscription', 'eventRegistration', 'payment'] as const)(
        'refuses once a %s references it',
        async (table) => {
            const p = prismaMock()
            p.discount.findFirst.mockResolvedValue(dto())
            p[table].count.mockResolvedValue(1)
            await expect(run(p).out).rejects.toThrow('Скидкой уже пользовались — уберите её в архив')
            expect(p.discount.delete).not.toHaveBeenCalled()
        },
    )

    it('a sale landing after the check (FK Restrict) is the same refusal', async () => {
        const p = prismaMock()
        p.discount.findFirst.mockResolvedValue(dto())
        p.discount.delete.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }))
        await expect(run(p).out).rejects.toThrow('Скидкой уже пользовались')
    })
})

describe('ListDiscountsHandler', () => {
    const run = (p: ReturnType<typeof prismaMock>, query: Record<string, unknown> = {}, role: string | null = 'admin') =>
        new ListDiscountsHandler(p as never, rbac() as never).execute(
            new ListDiscountsFeature(ListDiscountsInputSchema.parse(query), 'w1', 'inv', role, false),
        )

    it.each(STAFF_ROLES_REFUSED)('refuses a %s', async (role) => {
        await expect(run(prismaMock(), {}, role)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lists active discounts with uses, what they gave and their status; archived on request', async () => {
        const p = prismaMock()
        p.discount.findMany.mockResolvedValue([dto({ maxUses: 2 })])
        p.subscription.groupBy.mockResolvedValue([{ discountId: 'd1', _count: { _all: 2 } }])
        const sale = (over: Record<string, unknown>) => ({
            discountId: 'd1',
            currency: 'RUB',
            listPrice: 5000,
            amountPaid: 4250,
            discountAmount: 750,
            ...over,
        })
        p.subscription.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
            'discountId' in where
                ? [
                      sale({}),
                      // Paid at or above the list price: the discount gave nothing.
                      sale({ amountPaid: 5000 }),
                      // Paid above the discounted price: only what was given counts.
                      sale({ amountPaid: 4800 }),
                  ]
                : [],
        )
        p.eventRegistration.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
            'discountId' in where ? [sale({ listPrice: 1500, amountPaid: 1350, discountAmount: 150 })] : [],
        )
        const out = await run(p)
        expect(p.subscription.findMany.mock.calls.find((c) => 'discountId' in c[0].where)?.[0].where).toEqual({
            discountId: { in: ['d1'] },
            isPaid: true,
        })
        expect(p.discount.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'w1', isActive: true })
        // 750 + 0 + 200 + 150
        expect(out.data[0]).toMatchObject({ uses: 2, given: [{ currency: 'RUB', amount: 1100 }], status: 'exhausted' })

        await run(p, { archived: 'true' })
        expect(p.discount.findMany.mock.calls[1][0].where).toEqual({ workspaceId: 'w1' })
    })

    it('byStaff: paid sales in the window by paidAt, priced by staff (online excluded)', async () => {
        const p = prismaMock()
        p.subscription.findMany.mockResolvedValue([
            { pricedById: 'coach', listPrice: 5000, amountPaid: 4000, discountAmount: 0, discountId: null, currency: 'RUB' },
        ])
        p.eventRegistration.findMany.mockResolvedValue([
            { pricedById: 'coach', listPrice: 1500, amountPaid: 1350, discountAmount: 150, discountId: 'd1', currency: 'RUB' },
        ])
        p.user.findMany.mockResolvedValue([{ id: 'coach', firstname: 'Пётр', lastname: 'Петров', email: null }])
        const out = await run(p, { from: '2027-03-01', to: '2027-03-31' })
        const where = p.subscription.findMany.mock.calls[0][0].where
        expect(where).toMatchObject({ workspaceId: 'w1', isPaid: true, pricedById: { not: null }, listPrice: { not: null } })
        expect(where.paidAt.gte).toEqual(new Date('2027-02-28T21:00:00Z'))
        expect(out.byStaff).toEqual([
            {
                userId: 'coach',
                name: 'Пётр Петров',
                currency: 'RUB',
                oneOff: { count: 1, amount: 1000 },
                named: { count: 1, amount: 150 },
            },
        ])
    })
})

describe('summarizeStaffDiscounts', () => {
    const r = (over: Record<string, unknown>) => ({
        pricedById: 'a',
        listPrice: 5000,
        amountPaid: 5000,
        discountAmount: 0,
        discountId: null,
        currency: 'RUB',
        ...over,
    })

    it('splits per person and currency, drops sales without a discount, sorts by one-off amount', () => {
        const out = summarizeStaffDiscounts(
            [
                r({ amountPaid: 4500 }),
                r({ pricedById: 'b', amountPaid: 3000 }),
                r({ pricedById: 'b', amountPaid: 4250, discountAmount: 750, discountId: 'd1' }),
                r({ pricedById: 'b', currency: 'KZT', amountPaid: 4000 }),
                r({}),
                r({ pricedById: null, amountPaid: 1000 }),
            ],
            new Map([['b', 'Борис']]),
        )
        expect(out).toEqual([
            { userId: 'b', name: 'Борис', currency: 'RUB', oneOff: { count: 1, amount: 2000 }, named: { count: 1, amount: 750 } },
            { userId: 'b', name: 'Борис', currency: 'KZT', oneOff: { count: 1, amount: 1000 }, named: { count: 0, amount: 0 } },
            { userId: 'a', name: 'Бывший сотрудник', currency: 'RUB', oneOff: { count: 1, amount: 500 }, named: { count: 0, amount: 0 } },
        ])
    })
})
