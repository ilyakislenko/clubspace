import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    type JournalFilter,
    JOURNAL_MAX_DEPTH,
    journalSubscriptionWhere,
    journalTicketWhere,
    loadJournalEntry,
    loadJournalPage,
    loadJournalPeople,
    loadJournalRows,
    loadJournalTotals,
    loadUnappliedPayments,
    mergeJournalRows,
    parseJournalEntryId,
    resolveJournalPeriod,
    subscriptionJournalRow,
    summarizeJournalTotals,
    ticketJournalRow,
    unappliedPaymentWhere,
} from './journal'
import { revenueWindowStart, ticketsPaidInRangeWhere } from '../metrics/revenue'

const NOW = new Date('2026-11-15T12:00:00Z')
const RANGE = { gte: new Date('2026-10-16T12:00:00Z') }
const base: JournalFilter = { workspaceId: 'w1', range: RANGE }

const person = { firstname: 'Иван', lastname: 'Петров', email: 'ivan@x.ru' }
const sub = (id: string, at: string, over: Record<string, unknown> = {}) => ({
    id,
    paidAt: new Date(at),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    amountPaid: 4000,
    currency: 'RUB',
    paymentMethod: 'CASH' as const,
    markedPaidById: 'staff-1',
    classesTotal: 12,
    userId: 'u1',
    plan: { name: 'БЖЖ 12' },
    user: person,
    workspaceMember: { userId: 'u1', user: person },
    payment: null,
    ...over,
})
const ticket = (id: string, at: string, over: Record<string, unknown> = {}) => ({
    id,
    paidAt: new Date(at),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    amountPaid: 1500,
    currency: 'RUB',
    paymentMethod: 'TRANSFER' as const,
    markedPaidById: 'staff-2',
    userId: 'u2',
    eventId: 'e1',
    event: { title: 'Семинар по гвардам', currency: 'RUB' },
    user: { firstname: 'Анна', lastname: null, email: null },
    payments: [],
    ...over,
})

// A source that honours the `take` it is asked for, like the database.
const source = <T>(rows: T[]) => jest.fn(async (args: { take?: number }) => rows.slice(0, args.take ?? rows.length))

const prismaWith = (o: { subs?: unknown[]; tickets?: unknown[] } = {}) => ({
    subscription: {
        findMany: source(o.subs ?? []),
        count: jest.fn().mockResolvedValue((o.subs ?? []).length),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
    },
    eventRegistration: {
        findMany: source(o.tickets ?? []),
        count: jest.fn().mockResolvedValue((o.tickets ?? []).length),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
    },
    payment: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
})

describe('resolveJournalPeriod', () => {
    it('no dates = the revenue_30d window, open-ended like loadSales', () => {
        const p = resolveJournalPeriod({}, 'Asia/Tomsk', NOW)
        expect(p.range).toEqual({ gte: revenueWindowStart(NOW) })
        expect(p).toMatchObject({ from: '2026-10-16', to: '2026-11-15' })
    })

    it('dates are inclusive club-local days', () => {
        const p = resolveJournalPeriod({ from: '2026-11-01', to: '2026-11-30' }, 'Asia/Tomsk', NOW)
        // Томск is UTC+7: the 1st starts at 17:00 UTC the day before.
        expect(p.range.gte).toEqual(new Date('2026-10-31T17:00:00.000Z'))
        expect(p.range.lte).toEqual(new Date('2026-11-30T16:59:59.999Z'))
        expect(p).toMatchObject({ from: '2026-11-01', to: '2026-11-30' })
    })

    it.each([
        [{ from: '2026-11-01' }, /обе даты/],
        [{ to: '2026-11-01' }, /обе даты/],
        [{ from: '2026-11-02', to: '2026-11-01' }, /раньше начала/],
        [{ from: '2025-11-14', to: '2026-11-15' }, /366/],
    ])('refuses %j', (input, message) => {
        expect(() => resolveJournalPeriod(input, 'UTC', NOW)).toThrow(BadRequestError)
        expect(() => resolveJournalPeriod(input, 'UTC', NOW)).toThrow(message)
    })

    it('a full year (366 days) is allowed', () => {
        expect(() => resolveJournalPeriod({ from: '2025-11-15', to: '2026-11-15' }, 'UTC', NOW)).not.toThrow()
    })
})

describe('where-builders', () => {
    it('sales of the period: paid abonements by paidAt, tickets as revenue.ts counts them', () => {
        expect(journalSubscriptionWhere(base)).toEqual({ workspaceId: 'w1', isPaid: true, paidAt: RANGE })
        expect(journalTicketWhere(base)).toEqual({ workspaceId: 'w1', ...ticketsPaidInRangeWhere(RANGE) })
    })

    it('method, NONE and the marker filter every source', () => {
        const f = { ...base, method: 'CARD' as const, markedById: 'staff-1' }
        expect(journalSubscriptionWhere(f)).toMatchObject({ paymentMethod: 'CARD', markedPaidById: 'staff-1' })
        expect(journalTicketWhere(f)).toMatchObject({ paymentMethod: 'CARD', markedPaidById: 'staff-1' })
        expect(journalSubscriptionWhere({ ...base, method: 'NONE' }).paymentMethod).toBeNull()
        expect(journalTicketWhere({ ...base, method: 'NONE' }).paymentMethod).toBeNull()
    })

    it('a scope narrows to current members of its groups; the whole club does not', () => {
        const scope = { groupIds: new Set(['g1']), includeGroupless: false }
        expect(journalSubscriptionWhere({ ...base, scope }).workspaceMember).toEqual({
            user: { groupMemberships: { some: { groupId: { in: ['g1'] } } } },
        })
        expect(journalTicketWhere({ ...base, scope }).user).toEqual({
            AND: [
                {
                    workspaceMemberships: {
                        some: {
                            workspaceId: 'w1',
                            user: { groupMemberships: { some: { groupId: { in: ['g1'] } } } },
                        },
                    },
                },
            ],
        })
        const club = { groupIds: null, includeGroupless: true }
        expect(journalSubscriptionWhere({ ...base, scope: club })).not.toHaveProperty('workspaceMember')
        expect(journalTicketWhere({ ...base, scope: club })).not.toHaveProperty('user')
    })

    it('search looks at the holder', () => {
        // One AND-ed condition per word, on the holder.
        expect(journalSubscriptionWhere({ ...base, q: 'Иван Петров' })).toMatchObject({
            user: { AND: [expect.any(Object), expect.any(Object)] },
        })
        expect(journalTicketWhere({ ...base, q: 'Иван' })).toMatchObject({ user: { AND: [expect.any(Object)] } })
    })

    it('an unapplied online payment is never read as a sale', () => {
        // Sales come from Subscription / EventRegistration only; the strip
        // reads Payment rows that succeeded but could not be granted.
        expect(unappliedPaymentWhere('w1')).toEqual({
            workspaceId: 'w1',
            status: 'SUCCEEDED',
            activationError: { not: null },
        })
    })
})

describe('rows', () => {
    it('an abonement row: holder, item, marker, online side', () => {
        const row = subscriptionJournalRow(
            sub('s1', '2026-11-03T11:40:00Z', {
                paymentMethod: 'ONLINE',
                markedPaidById: null,
                payment: { id: 'p1', provider: 'YOOKASSA', providerPaymentId: 'yk-00ab12cd', status: 'SUCCEEDED' },
            }),
        )
        expect(row).toMatchObject({
            id: 'sub:s1',
            source: 'abonement',
            amount: 4000,
            method: 'ONLINE',
            userId: 'u1',
            itemName: 'БЖЖ 12',
            subscriptionId: 's1',
            markedById: null,
            online: { id: 'p1' },
        })
    })

    it('a legacy abonement without a holder column falls back to its membership', () => {
        const row = subscriptionJournalRow(sub('s1', '2026-11-03T11:40:00Z', { userId: null, user: null }))
        expect(row).toMatchObject({ userId: 'u1', person })
    })

    it('a ticket row: event currency when its own is missing; online only when paid online', () => {
        const online = { id: 'p2', provider: 'STRIPE', providerPaymentId: 'cs_1', status: 'SUCCEEDED' }
        expect(
            ticketJournalRow(ticket('r1', '2026-11-03T11:40:00Z', { currency: null, amountPaid: null, payments: [online] })),
        ).toMatchObject({ id: 'reg:r1', currency: 'RUB', amount: 0, online: null, eventId: 'e1' })
        expect(
            ticketJournalRow(ticket('r1', '2026-11-03T11:40:00Z', { paymentMethod: 'ONLINE', payments: [online] })).online,
        ).toEqual(online)
    })
})

describe('loadJournalPage', () => {
    const subs = [
        sub('s3', '2026-11-10T10:00:00Z'),
        sub('s2', '2026-11-05T10:00:00Z'),
        sub('s1', '2026-11-01T10:00:00Z'),
    ]
    const tickets = [ticket('r2', '2026-11-07T10:00:00Z'), ticket('r1', '2026-11-05T10:00:00Z')]

    it('merges the sources newest first (same instant: id descending) and slices the page', async () => {
        const prisma = prismaWith({ subs, tickets })
        const first = await loadJournalPage(prisma as never, base, { curPage: 1, perPage: 2 })
        expect(first.rows.map((r) => r.id)).toEqual(['sub:s3', 'reg:r2'])
        expect(first.total).toBe(5)
        const second = await loadJournalPage(prisma as never, base, { curPage: 2, perPage: 2 })
        // s2 and r1 share an instant: the larger id first.
        expect(second.rows.map((r) => r.id)).toEqual(['sub:s2', 'reg:r1'])
        const third = await loadJournalPage(prisma as never, base, { curPage: 3, perPage: 2 })
        expect(third.rows.map((r) => r.id)).toEqual(['sub:s1'])
    })

    it('reads each source to the page depth, in journal order', async () => {
        const prisma = prismaWith({ subs, tickets })
        await loadJournalPage(prisma as never, base, { curPage: 2, perPage: 2 })
        const args = prisma.subscription.findMany.mock.calls[0][0] as Record<string, unknown>
        expect(args).toMatchObject({ take: 4, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] })
        expect(prisma.eventRegistration.findMany.mock.calls[0][0]).toMatchObject({ take: 4 })
    })

    it('refuses to read deeper than the cap', async () => {
        const prisma = prismaWith({ subs })
        await expect(
            loadJournalPage(prisma as never, base, { curPage: JOURNAL_MAX_DEPTH / 50 + 1, perPage: 50 }),
        ).rejects.toThrow(/Слишком далеко/)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
        await expect(
            loadJournalPage(prisma as never, base, { curPage: JOURNAL_MAX_DEPTH / 50, perPage: 50 }),
        ).resolves.toMatchObject({ total: 3 })
    })

    it('«only refunds» has no sales to show', async () => {
        const prisma = prismaWith({ subs, tickets })
        expect(await loadJournalPage(prisma as never, { ...base, kind: 'refund' }, { curPage: 1, perPage: 50 })).toEqual({
            rows: [],
            total: 0,
        })
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('the CSV reads every row, unpaged, in the same order', async () => {
        const prisma = prismaWith({ subs, tickets })
        const rows = await loadJournalRows(prisma as never, base)
        expect(rows.map((r) => r.id)).toEqual(['sub:s3', 'reg:r2', 'sub:s2', 'reg:r1', 'sub:s1'])
        expect(prisma.subscription.findMany.mock.calls[0][0]).not.toHaveProperty('take')
    })
})

describe('mergeJournalRows', () => {
    it('is the order of each source kept', () => {
        const a = [sub('b', '2026-11-02T00:00:00Z'), sub('a', '2026-11-02T00:00:00Z')].map(subscriptionJournalRow)
        expect(mergeJournalRows([a, []]).map((r) => r.rawId)).toEqual(['b', 'a'])
    })
})

describe('totals', () => {
    it('per currency (dominant first) and method (fixed order); NONE for nothing recorded; empty methods left out', () => {
        expect(
            summarizeJournalTotals([
                { method: 'ONLINE', currency: 'RUB', amount: 5000, count: 1 },
                { method: null, currency: 'RUB', amount: 800, count: 1 },
                { method: 'CASH', currency: 'USD', amount: 50, count: 1 },
                { method: 'CASH', currency: 'RUB', amount: 3000, count: 2 },
                { method: 'CARD', currency: 'RUB', amount: 0, count: 0 },
            ]),
        ).toEqual([
            {
                currency: 'RUB',
                received: 8800,
                refunded: 0,
                net: 8800,
                byMethod: [
                    { method: 'CASH', received: 3000, refunded: 0, count: 2 },
                    { method: 'ONLINE', received: 5000, refunded: 0, count: 1 },
                    { method: 'NONE', received: 800, refunded: 0, count: 1 },
                ],
            },
            {
                currency: 'USD',
                received: 50,
                refunded: 0,
                net: 50,
                byMethod: [{ method: 'CASH', received: 50, refunded: 0, count: 1 }],
            },
        ])
    })

    it('groups every source over the whole view, a ticket without a currency in its event’s', async () => {
        const prisma = prismaWith()
        prisma.subscription.groupBy.mockResolvedValue([
            { paymentMethod: 'CASH', currency: 'RUB', _sum: { amountPaid: 4000 }, _count: { _all: 1 } },
        ])
        prisma.eventRegistration.groupBy.mockResolvedValue([
            { paymentMethod: 'CASH', currency: 'RUB', _sum: { amountPaid: 1500 }, _count: { _all: 1 } },
            { paymentMethod: 'TRANSFER', currency: null, _sum: { amountPaid: 1500 }, _count: { _all: 1 } },
        ])
        prisma.eventRegistration.findMany.mockResolvedValue([{ amountPaid: 1500, event: { currency: 'RUB' } }] as never)
        const f = { ...base, method: undefined, markedById: 'staff-1' }
        const totals = await loadJournalTotals(prisma as never, f)
        expect(totals).toEqual([
            {
                currency: 'RUB',
                received: 7000,
                refunded: 0,
                net: 7000,
                byMethod: [
                    { method: 'CASH', received: 5500, refunded: 0, count: 2 },
                    { method: 'TRANSFER', received: 1500, refunded: 0, count: 1 },
                ],
            },
        ])
        expect(prisma.subscription.groupBy.mock.calls[0][0]).toMatchObject({
            by: ['paymentMethod', 'currency'],
            where: journalSubscriptionWhere(f),
        })
        expect(prisma.eventRegistration.groupBy.mock.calls[0][0].where).toEqual(journalTicketWhere(f))
    })

    it('«only refunds» totals nothing in phase A', async () => {
        const prisma = prismaWith()
        expect(await loadJournalTotals(prisma as never, { ...base, kind: 'refund' })).toEqual([])
        expect(prisma.subscription.groupBy).not.toHaveBeenCalled()
    })
})

describe('people', () => {
    it('names the markers and tells who is a member now', async () => {
        const prisma = prismaWith()
        prisma.user.findMany.mockResolvedValue([{ id: 'staff-1', firstname: 'Ольга', lastname: 'Админ', email: null }])
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'u1' }])
        const rows = [subscriptionJournalRow(sub('s1', '2026-11-03T00:00:00Z')), ticketJournalRow(ticket('r1', '2026-11-03T00:00:00Z'))]
        const people = await loadJournalPeople(prisma as never, 'w1', rows)
        expect(people.names.get('staff-1')).toBe('Ольга Админ')
        expect([...people.members]).toEqual(['u1'])
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'w1', userId: { in: ['u1', 'u2'] } })
    })

    it('asks nothing for an empty page', async () => {
        const prisma = prismaWith()
        await loadJournalPeople(prisma as never, 'w1', [])
        expect(prisma.user.findMany).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })
})

describe('unapplied payments', () => {
    it('the whole club, oldest first, at most 20', async () => {
        const prisma = prismaWith()
        prisma.payment.count.mockResolvedValue(21)
        const out = await loadUnappliedPayments(prisma as never, 'w1')
        expect(out.total).toBe(21)
        expect(prisma.payment.findMany.mock.calls[0][0]).toMatchObject({
            where: unappliedPaymentWhere('w1'),
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 20,
        })
    })
})

describe('one entry', () => {
    const id = '0d4e8f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6'

    it('parses sub:/reg: ids; anything else is not an entry', () => {
        expect(parseJournalEntryId(`sub:${id}`)).toEqual({ source: 'abonement', id })
        expect(parseJournalEntryId(`reg:${id}`)).toEqual({ source: 'ticket', id })
        for (const bad of [`ref:${id}`, 'sub:nope', id, `sub:${id}:x`, '']) {
            expect(parseJournalEntryId(bad)).toBeNull()
        }
    })

    it('loads a paid sale of this club only', async () => {
        const prisma = prismaWith()
        prisma.subscription.findFirst.mockResolvedValue(sub(id, '2026-11-03T00:00:00Z'))
        expect(await loadJournalEntry(prisma as never, 'w1', `sub:${id}`)).toMatchObject({ id: `sub:${id}` })
        expect(prisma.subscription.findFirst.mock.calls[0][0].where).toEqual({ id, workspaceId: 'w1', isPaid: true })
        prisma.eventRegistration.findFirst.mockResolvedValue(ticket(id, '2026-11-03T00:00:00Z'))
        expect(await loadJournalEntry(prisma as never, 'w1', `reg:${id}`)).toMatchObject({ id: `reg:${id}` })
        expect(prisma.eventRegistration.findFirst.mock.calls[0][0].where).toEqual({ id, workspaceId: 'w1', isPaid: true })
    })

    it('null for a malformed id or a row that is not a sale', async () => {
        const prisma = prismaWith()
        expect(await loadJournalEntry(prisma as never, 'w1', 'ref:x')).toBeNull()
        expect(prisma.subscription.findFirst).not.toHaveBeenCalled()
        expect(await loadJournalEntry(prisma as never, 'w1', `sub:${id}`)).toBeNull()
        expect(await loadJournalEntry(prisma as never, 'w1', `reg:${id}`)).toBeNull()
    })
})
