jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../online-payments/load-buyer', () => ({ PENDING_REUSE_MS: 30 * 60 * 1000 }))
jest.mock('../../domains/discounts/family', () => ({ loadFamilyEligibility: jest.fn() }))

import { loadFamilyEligibility } from '../../domains/discounts/family'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListSaleDiscountsFeature } from './list-sale-discounts.feature'
import { ListSaleDiscountsHandler } from './list-sale-discounts.handler'

const discount = (over: Record<string, unknown> = {}) => ({
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
    plans: [] as Array<{ planId: string }>,
    ...over,
})

const prismaMock = (discounts: unknown[], uses: { club?: number; member?: number } = {}) => ({
    workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }) },
    plan: {
        findMany: jest.fn().mockResolvedValue([
            { id: 'p1', price: 4000, currency: 'RUB' },
            { id: 'p2', price: 0, currency: 'RUB' },
        ]),
    },
    workspaceEvent: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', price: 1500, currency: 'RUB' }) },
    discount: { findMany: jest.fn().mockResolvedValue(discounts) },
    subscription: {
        groupBy: jest.fn(async ({ where }: { where: { discountId: { in: string[] }; userId?: string } }) =>
            where.discountId.in.map((discountId) => ({
                discountId,
                _count: { _all: where.userId ? (uses.member ?? 0) : (uses.club ?? 0) },
            })),
        ),
    },
    eventRegistration: { groupBy: jest.fn().mockResolvedValue([]) },
})

const rbac = (allowed = true, allGroups = false) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({ scope: allGroups ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn(() => allGroups),
    assertCanWriteMember: jest.fn(async () => {
        if (!allowed) throw new ForbiddenError({ message: 'Участник не состоит в ваших группах' })
    }),
})

const run = (p: unknown, r = rbac(), eventId?: string) =>
    new ListSaleDiscountsHandler(p as never, r as never).execute(
        new ListSaleDiscountsFeature({ eventId }, 'w1', 'member', 'coach', 'coach', false),
    )

beforeEach(() => (loadFamilyEligibility as jest.Mock).mockResolvedValue(false))

describe('ListSaleDiscountsHandler', () => {
    it('refuses a coach outside the member’s groups', async () => {
        const p = prismaMock([discount()])
        await expect(run(p, rbac(false))).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.discount.findMany).not.toHaveBeenCalled()
    })

    it('a coach gets the active tariffs; whoever may sell an archived one (all groups) gets it priced too', async () => {
        const coach = prismaMock([discount()])
        await run(coach)
        expect(coach.plan.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'w1', isActive: true })
        const admin = prismaMock([discount()])
        await run(admin, rbac(true, true))
        expect(admin.plan.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'w1' })
    })

    it('prices each active tariff (never a free one) and carries no amount permission flag', async () => {
        const out = await run(prismaMock([discount({ code: 'СТУД', endsOn: new Date('2027-12-31') })]))
        expect(out).toEqual({
            familyEligible: false,
            options: [
                {
                    discountId: 'd1',
                    name: 'Студенческая',
                    kind: 'PERCENT',
                    value: 15,
                    code: 'СТУД',
                    isFamily: false,
                    endsOn: '2027-12-31',
                    items: [{ planId: 'p1', eventId: null, listPrice: 4000, amount: 3400, currency: 'RUB' }],
                },
            ],
        })
    })

    it('offers the family discount only when the member’s family qualifies, first', async () => {
        const rows = [discount(), discount({ id: 'f1', name: 'Семейная', isFamily: true, value: 10 })]
        expect((await run(prismaMock(rows))).options.map((o) => o.discountId)).toEqual(['d1'])
        ;(loadFamilyEligibility as jest.Mock).mockResolvedValue(true)
        const out = await run(prismaMock(rows))
        expect(out.familyEligible).toBe(true)
        expect(out.options.map((o) => o.discountId)).toEqual(['f1', 'd1'])
        expect(loadFamilyEligibility).toHaveBeenLastCalledWith(expect.anything(), {
            workspaceId: 'w1',
            userId: 'member',
            now: expect.any(Date),
        })
    })

    it('leaves out an exhausted one and one this member already used', async () => {
        expect((await run(prismaMock([discount({ maxUses: 3 })], { club: 3 }))).options).toEqual([])
        expect((await run(prismaMock([discount({ maxUses: 3 })], { club: 2 }))).options).toHaveLength(1)
        expect((await run(prismaMock([discount({ oncePerMember: true })], { member: 1 }))).options).toEqual([])
        expect((await run(prismaMock([discount({ oncePerMember: true })], { member: 0 }))).options).toHaveLength(1)
    })

    it('leaves out an out-of-date one and one with nothing in scope', async () => {
        const out = await run(
            prismaMock([
                discount({ endsOn: new Date('2020-01-01') }),
                discount({ id: 'd2', allPlans: false, plans: [{ planId: 'p9' }] }),
            ]),
        )
        expect(out.options).toEqual([])
    })

    it('with eventId: that event’s ticket, only for discounts covering events', async () => {
        const p = prismaMock([discount(), discount({ id: 'ev', name: 'Мастер-классы', events: true, kind: 'FIXED', value: 500, currency: 'RUB' })])
        const out = await run(p, rbac(), 'e1')
        expect(out.options).toEqual([
            expect.objectContaining({
                discountId: 'ev',
                items: [{ planId: null, eventId: 'e1', listPrice: 1500, amount: 1000, currency: 'RUB' }],
            }),
        ])
        expect(p.workspaceEvent.findFirst).toHaveBeenCalledWith({
            where: { id: 'e1', workspaceId: 'w1' },
            select: { id: true, price: true, currency: true },
        })
        expect(p.plan.findMany).not.toHaveBeenCalled()
    })

    it('404s an event of another club', async () => {
        const p = prismaMock([discount()])
        p.workspaceEvent.findFirst.mockResolvedValue(null)
        await expect(run(p, rbac(), 'e1')).rejects.toThrow('Событие не найдено')
    })
})
