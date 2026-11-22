jest.mock('../../features/online-payments/load-buyer', () => ({ PENDING_REUSE_MS: 30 * 60 * 1000 }))
jest.mock('./family', () => ({ loadFamilyEligibility: jest.fn() }))

import { loadFamilyEligibility } from './family'
import { lockDiscount, priceStaffSale, resolveAutomaticDiscount } from './discounts'

const row = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    name: 'Весна',
    kind: 'PERCENT',
    value: 10,
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
    plans: [],
    ...over,
})

const now = new Date('2027-03-01T05:00:00Z')
const item = { planId: 'p1', eventId: null, listPrice: 5000, currency: 'RUB' }

const tx = (discount: unknown, uses: { mine?: number; all?: number } = {}) => {
    const order: string[] = []
    const t = {
        order,
        $queryRaw: jest.fn(async () => {
            order.push('lock')
            return [{ id: 'd1' }]
        }),
        discount: {
            findFirst: jest.fn(async () => {
                order.push('load')
                return discount
            }),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }) },
        subscription: {
            count: jest.fn(async ({ where }: { where: { userId?: string } }) => {
                order.push(where.userId ? 'count-member' : 'count-club')
                return where.userId ? (uses.mine ?? 0) : (uses.all ?? 0)
            }),
        },
        eventRegistration: { count: jest.fn().mockResolvedValue(0) },
        payment: { count: jest.fn().mockResolvedValue(0) },
    }
    return t
}

const price = (t: ReturnType<typeof tx>) =>
    priceStaffSale(t as never, {
        workspaceId: 'w1',
        discountId: 'd1',
        userId: 'u1',
        item,
        now,
        timezone: 'Asia/Tomsk',
    })

beforeEach(() => (loadFamilyEligibility as jest.Mock).mockReset())

describe('lockDiscount', () => {
    it('takes the discount row lock', async () => {
        const t = tx(row())
        expect(await lockDiscount(t as never, 'd1')).toBe(true)
        const sql = (t.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?')
        expect(sql).toContain('FOR UPDATE')
        expect(sql).toContain('"Discount"')
    })
})

describe('priceStaffSale', () => {
    it('locks before counting uses, then prices', async () => {
        const t = tx(row({ maxUses: 5, oncePerMember: true }), { mine: 0, all: 4 })
        expect(await price(t)).toEqual({
            amount: 4500,
            discountAmount: 500,
            discountId: 'd1',
            discountName: 'Весна',
        })
        expect(t.order).toEqual(['lock', 'load', 'count-member', 'count-club'])
    })

    it('404s a discount of another club', async () => {
        await expect(price(tx(null))).rejects.toThrow('Скидка не найдена')
    })

    it('refuses with the rule texts', async () => {
        await expect(price(tx(row({ endsOn: new Date('2027-02-28') })))).rejects.toThrow(
            'Срок скидки «Весна» закончился',
        )
        await expect(price(tx(row({ allPlans: false, plans: [{ planId: 'p2' }] })))).rejects.toThrow(
            'Скидка «Весна» не действует на этот тариф',
        )
        await expect(price(tx(row({ oncePerMember: true }), { mine: 1 }))).rejects.toThrow(
            'Скидка «Весна» уже использована этим учеником',
        )
        await expect(price(tx(row({ maxUses: 3 }), { all: 3 }))).rejects.toThrow(
            'Лимит скидки «Весна» исчерпан',
        )
    })

    it('a family discount only for a member whose family qualifies', async () => {
        ;(loadFamilyEligibility as jest.Mock).mockResolvedValue(false)
        await expect(price(tx(row({ isFamily: true })))).rejects.toThrow(
            'Семейная скидка — только если у члена семьи есть действующий абонемент',
        )
        ;(loadFamilyEligibility as jest.Mock).mockResolvedValue(true)
        expect((await price(tx(row({ isFamily: true })))).amount).toBe(4500)
        expect(loadFamilyEligibility).toHaveBeenLastCalledWith(expect.anything(), {
            workspaceId: 'w1',
            userId: 'u1',
            now,
        })
    })
})

describe('resolveAutomaticDiscount', () => {
    it('is the active family discount when it prices the item and the buyer qualifies', async () => {
        ;(loadFamilyEligibility as jest.Mock).mockResolvedValue(true)
        const t = tx(row({ isFamily: true }))
        const out = await resolveAutomaticDiscount(t as never, { workspaceId: 'w1', userId: 'u1', item, now })
        expect(out).toMatchObject({ id: 'd1', isFamily: true, planIds: [] })
        expect(t.discount.findFirst.mock.calls[0]).toEqual([
            expect.objectContaining({ where: { workspaceId: 'w1', isFamily: true, isActive: true } }),
        ])
    })

    it('is null without a family discount, out of scope, or when the buyer does not qualify', async () => {
        ;(loadFamilyEligibility as jest.Mock).mockResolvedValue(true)
        expect(await resolveAutomaticDiscount(tx(null) as never, { workspaceId: 'w1', userId: 'u1', item, now })).toBeNull()
        expect(
            await resolveAutomaticDiscount(tx(row({ isFamily: true })) as never, {
                workspaceId: 'w1',
                userId: 'u1',
                item: { planId: null, eventId: 'e1', listPrice: 1000, currency: 'RUB' },
                now,
            }),
        ).toBeNull()
        ;(loadFamilyEligibility as jest.Mock).mockResolvedValue(false)
        expect(
            await resolveAutomaticDiscount(tx(row({ isFamily: true })) as never, { workspaceId: 'w1', userId: 'u1', item, now }),
        ).toBeNull()
    })
})
