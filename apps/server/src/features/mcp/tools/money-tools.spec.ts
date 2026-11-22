import type { AiAccess } from '../../../domains/ai-assistant/ai-access'
import { McpScope } from '../mcp-scope'
import type { McpToolContext } from '../mcp-tool'
import { McpPeople } from '../mcp-people'
import { revenueReportTool } from './money-tools'

const NOW = new Date('2026-11-15T12:00:00Z')

const access = (directionIds: string[] | null): AiAccess => ({
    workspaceId: 'w1',
    workspaceName: 'Клуб',
    timezone: 'Europe/Moscow',
    ownerId: 'u0',
    userId: 'u0',
    roleName: null,
    isOwner: directionIds === null,
    isClubAdmin: directionIds === null,
    directionIds,
})

const subscription = {
    amountPaid: 4000,
    currency: 'RUB',
    paidAt: new Date('2026-11-02T10:00:00Z'),
    createdAt: new Date('2026-11-02T10:00:00Z'),
    planId: 'p8',
    plan: { name: '8 занятий' },
    directions: [{ direction: { id: 'bjj', name: 'БЖЖ' } }],
}

const ticket = (eventId: string, title: string, direction: { id: string; name: string } | null) => ({
    amountPaid: 1500,
    currency: 'RUB',
    paidAt: new Date('2026-11-10T10:00:00Z'),
    createdAt: new Date('2026-11-01T10:00:00Z'),
    eventId,
    event: { title, currency: 'RUB', direction },
})

const run = async (
    args: Record<string, unknown>,
    rows: { subs?: unknown[]; tickets?: unknown[]; refunds?: unknown[] } = {},
    directionIds: string[] | null = null,
) => {
    const tickets = jest.fn().mockResolvedValue(rows.tickets ?? [])
    const refunds = jest.fn().mockResolvedValue(rows.refunds ?? [])
    const prisma = {
        subscription: { findMany: jest.fn().mockResolvedValue(rows.subs ?? []) },
        eventRegistration: { findMany: tickets },
        refund: { findMany: refunds },
        user: { findMany: jest.fn().mockResolvedValue([{ id: 'coach-1', firstname: 'Роман', lastname: 'Савельев' }]) },
    }
    const ctx = {
        prisma,
        people: new McpPeople('secret', 'w1', 'PERSONAL'),
        access: access(directionIds),
        scope: new McpScope(access(directionIds)),
        now: NOW,
    } as unknown as McpToolContext
    const input = revenueReportTool.input.parse(args)
    const out = await revenueReportTool.run(ctx, input)
    return { data: out.data as Record<string, unknown>, tickets, refunds }
}

describe('revenue_report: discounts', () => {
    it('sums discounts_given of the period: by discount name, one-offs by who priced them', async () => {
        const priced = (over: Record<string, unknown>) => ({
            ...subscription,
            listPrice: null,
            discountName: null,
            discountAmount: 0,
            pricedById: null,
            ...over,
        })
        const { data } = await run({ month: '2026-11' }, {
            subs: [
                // «Семейная» 400 of 4 000.
                priced({ amountPaid: 3600, listPrice: 4000, discountName: 'Семейная', discountAmount: 400, pricedById: 'admin-1' }),
                // The head coach took 1 000 less in cash.
                priced({ amountPaid: 3000, listPrice: 4000, pricedById: 'coach-1' }),
                // Before discounts: nothing to count; at the price: nothing either.
                priced({ amountPaid: 4000 }),
                priced({ amountPaid: 4000, listPrice: 4000, pricedById: 'coach-1' }),
            ],
        })
        expect(data.discounts).toEqual({
            total: 1400,
            count: 2,
            byDiscount: [{ name: 'Семейная', count: 1, amount: 400 }],
            oneOff: {
                amount: 1000,
                byStaff: [{ ref: expect.stringMatching(/^c_/), name: 'Роман Савельев', count: 1, amount: 1000 }],
            },
        })
        // Revenue stays what was charged.
        expect(data.total).toBe(14600)
    })
})

describe('revenue_report: event tickets', () => {
    it('adds paid tickets once, split «абонементы / события»', async () => {
        const { data } = await run(
            { groupBy: 'month' },
            {
                subs: [subscription],
                tickets: [ticket('e1', 'Мастер-класс', null), ticket('e1', 'Мастер-класс', null)],
            },
        )
        expect(data).toMatchObject({
            total: 7000,
            sales: 3,
            bySource: {
                abonements: { revenue: 4000, sales: 1 },
                events: { revenue: 3000, sales: 2 },
            },
        })
        const items = data.items as { key: string; revenue: number }[]
        expect(items.reduce((s, i) => s + i.revenue, 0)).toBe(7000)
        expect(items.at(-1)).toMatchObject({ key: '2026-11', revenue: 7000, sales: 3 })
    })

    it('puts a ticket under its event’s direction; an event without one is club-wide', async () => {
        const { data } = await run(
            { groupBy: 'direction' },
            {
                subs: [subscription],
                tickets: [ticket('e1', 'Семинар', { id: 'bjj', name: 'БЖЖ' }), ticket('e2', 'Открытый урок', null)],
            },
        )
        expect(data.items).toEqual([
            { key: 'bjj', label: 'БЖЖ', revenue: 5500, sales: 2 },
            { key: 'club', label: 'Весь клуб (продажи без направления)', revenue: 1500, sales: 1 },
        ])
    })

    it('lists an event as its own row by tariff, without a tariff ref', async () => {
        const { data } = await run(
            { groupBy: 'tariff' },
            { subs: [subscription], tickets: [ticket('e1', 'Мастер-класс', null)] },
        )
        expect(data.items).toEqual(
            expect.arrayContaining([
                { key: 'p8', label: '8 занятий', revenue: 4000, sales: 1, kind: 'tariff', ref: '[plan:p8]' },
                { key: 'e1', label: 'Мастер-класс', revenue: 1500, sales: 1, kind: 'event' },
            ]),
        )
    })

    it('reads only tickets marked paid, by payment date, within the scope’s events', async () => {
        const admin = await run({ month: '2026-10' })
        const where = admin.tickets.mock.calls[0][0].where
        expect(where).toMatchObject({ workspaceId: 'w1', isPaid: true, event: { workspaceId: 'w1' } })
        expect(where.paidAt.gte).toBeInstanceOf(Date)
        expect(where.paidAt.lte).toBeInstanceOf(Date)
        expect(where.event.directionId).toBeUndefined()

        const manager = await run({}, {}, ['bjj'])
        expect(manager.tickets.mock.calls[0][0].where.event).toEqual({
            workspaceId: 'w1',
            directionId: { in: ['bjj'] },
        })
    })
})

// A refund of a sale is a negative row keyed like its sale, dated by refund
// (payments journal §6): `total` is net, `received` and `refunded` beside it.
describe('revenue_report: refunds', () => {
    const abonementRefund = (amount: number, refundedAt: string) => ({
        amount,
        currency: 'RUB',
        refundedAt: new Date(refundedAt),
        subscription: {
            planId: 'p8',
            plan: { name: '8 занятий' },
            directions: [{ direction: { id: 'bjj', name: 'БЖЖ' } }],
        },
        eventRegistration: null,
    })
    // A ticket sold before the period, refunded inside it.
    const ticketRefund = {
        amount: 500,
        currency: 'RUB',
        refundedAt: new Date('2026-11-12T10:00:00Z'),
        subscription: null,
        eventRegistration: { eventId: 'e0', event: { title: 'Старый семинар', direction: null } },
    }
    const rows = {
        subs: [subscription],
        tickets: [ticket('e1', 'Мастер-класс', null)],
        refunds: [abonementRefund(1000, '2026-11-05T10:00:00Z'), ticketRefund],
    }

    it('reports received, refunded and a net total, per source too', async () => {
        const { data } = await run({ groupBy: 'month' }, rows)
        expect(data).toMatchObject({
            received: 5500,
            refunded: 1500,
            total: 4000,
            sales: 2,
            bySource: {
                abonements: { revenue: 3000, received: 4000, refunded: 1000, sales: 1 },
                events: { revenue: 1000, received: 1500, refunded: 500, sales: 1 },
            },
        })
        // A refund is not a sale: the month keeps its two sales.
        expect((data.items as unknown[]).at(-1)).toEqual({
            key: '2026-11',
            label: '2026-11',
            revenue: 4000,
            sales: 2,
        })
    })

    it('lands a refund in the month it was made, not the sale’s', async () => {
        const { data } = await run(
            { month: '2026-10' },
            { subs: [], refunds: [abonementRefund(700, '2026-10-20T10:00:00Z')] },
        )
        expect(data).toMatchObject({ received: 0, refunded: 700, total: -700, currency: 'RUB' })
    })

    it('takes a refund off its tariff, its event and its directions', async () => {
        const byTariff = await run({ groupBy: 'tariff' }, rows)
        expect(byTariff.data.items).toEqual(
            expect.arrayContaining([
                { key: 'p8', label: '8 занятий', revenue: 3000, sales: 1, kind: 'tariff', ref: '[plan:p8]' },
                { key: 'e1', label: 'Мастер-класс', revenue: 1500, sales: 1, kind: 'event' },
                { key: 'e0', label: 'Старый семинар', revenue: -500, sales: 0, kind: 'event' },
            ]),
        )
        const byDirection = await run({ groupBy: 'direction' }, rows)
        expect(byDirection.data.items).toEqual([
            { key: 'bjj', label: 'БЖЖ', revenue: 3000, sales: 1 },
            { key: 'club', label: 'Весь клуб (продажи без направления)', revenue: 1000, sales: 1 },
        ])
    })

    it('reads refunds of sales only (never of an unapplied payment), by refund date', async () => {
        const { refunds } = await run({ month: '2026-10' }, {}, ['bjj'])
        const where = refunds.mock.calls[0][0].where
        expect(where).toMatchObject({
            workspaceId: 'w1',
            OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }],
        })
        expect(where.refundedAt.gte).toBeInstanceOf(Date)
        expect(where.refundedAt.lte).toBeInstanceOf(Date)
        // A ticket's refund within the scope's events, like the tickets.
        expect(where.AND[0].OR[1]).toEqual({
            eventRegistration: { event: { workspaceId: 'w1', directionId: { in: ['bjj'] } } },
        })
    })
})
