import type { AiAccess } from '../../../domains/ai-assistant/ai-access'
import { McpScope } from '../mcp-scope'
import type { McpToolContext } from '../mcp-tool'
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
    rows: { subs?: unknown[]; tickets?: unknown[] } = {},
    directionIds: string[] | null = null,
) => {
    const tickets = jest.fn().mockResolvedValue(rows.tickets ?? [])
    const prisma = {
        subscription: { findMany: jest.fn().mockResolvedValue(rows.subs ?? []) },
        eventRegistration: { findMany: tickets },
    }
    const ctx = {
        prisma,
        access: access(directionIds),
        scope: new McpScope(access(directionIds)),
        now: NOW,
    } as unknown as McpToolContext
    const input = revenueReportTool.input.parse(args)
    const out = await revenueReportTool.run(ctx, input)
    return { data: out.data as Record<string, unknown>, tickets }
}

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
