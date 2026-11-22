import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    type JournalFilter,
    JOURNAL_MAX_DEPTH,
    journalSubscriptionWhere,
    journalRefundWhere,
    journalTicketWhere,
    fullRefundCancelsRegistration,
    loadJournalEntry,
    loadJournalPage,
    loadJournalPeople,
    loadJournalRows,
    loadJournalTotals,
    loadUnappliedPayments,
    mergeJournalRows,
    parseJournalEntryId,
    refundJournalRow,
    loadSaleRefunds,
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
// A sale recorded before discounts: no list price.
const noDiscount = { listPrice: null, discountId: null, discountName: null, discountAmount: 0, pricedById: null }
const sub = (id: string, at: string, over: Record<string, unknown> = {}) => ({
    id,
    paidAt: new Date(at),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    amountPaid: 4000,
    refundedAmount: 0,
    currency: 'RUB',
    paymentMethod: 'CASH' as const,
    markedPaidById: 'staff-1',
    classesTotal: 12,
    userId: 'u1',
    plan: { name: 'БЖЖ 12' },
    user: person,
    workspaceMember: { userId: 'u1', user: person },
    payment: null,
    ...noDiscount,
    ...over,
})
const ticket = (id: string, at: string, over: Record<string, unknown> = {}) => ({
    id,
    paidAt: new Date(at),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    amountPaid: 1500,
    refundedAmount: 0,
    currency: 'RUB',
    paymentMethod: 'TRANSFER' as const,
    markedPaidById: 'staff-2',
    userId: 'u2',
    eventId: 'e1',
    event: { title: 'Семинар по гвардам', currency: 'RUB' },
    user: { firstname: 'Анна', lastname: null, email: null },
    payments: [],
    ...noDiscount,
    ...over,
})

const refund = (id: string, at: string, over: Record<string, unknown> = {}) => ({
    id,
    refundedAt: new Date(at),
    amount: 1000,
    currency: 'RUB',
    method: 'CASH' as const,
    reason: 'Пропустил две недели',
    createdById: 'staff-1',
    userId: 'u1',
    itemName: 'БЖЖ 12',
    user: person,
    subscription: { id: 's1', paidAt: new Date('2026-11-01T10:00:00Z'), createdAt: new Date('2026-10-01T00:00:00Z'), amountPaid: 4000 },
    eventRegistration: null,
    payment: null,
    ...over,
})

// A source that honours the `take` it is asked for, like the database.
const source = <T>(rows: T[]) => jest.fn(async (args: { take?: number }) => rows.slice(0, args.take ?? rows.length))

const prismaWith = (o: { subs?: unknown[]; tickets?: unknown[]; refunds?: unknown[] } = {}) => ({
    refund: {
        findMany: source(o.refunds ?? []),
        count: jest.fn().mockResolvedValue((o.refunds ?? []).length),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
    },
    subscription: {
        findMany: source(o.subs ?? []),
        count: jest.fn().mockResolvedValue((o.subs ?? []).length),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        fields: { listPrice: 'Subscription.listPrice' },
    },
    eventRegistration: {
        findMany: source(o.tickets ?? []),
        count: jest.fn().mockResolvedValue((o.tickets ?? []).length),
        groupBy: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        fields: { listPrice: 'EventRegistration.listPrice' },
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

// Stand-ins for the client's field references (prisma.<model>.fields).
const SUB_FIELDS = { listPrice: 'Subscription.listPrice' } as never
const TICKET_FIELDS = { listPrice: 'EventRegistration.listPrice' } as never
const subWhere = (f: JournalFilter) => journalSubscriptionWhere(f, SUB_FIELDS)
const ticketWhere = (f: JournalFilter) => journalTicketWhere(f, TICKET_FIELDS)

describe('where-builders', () => {
    it('sales of the period: paid abonements by paidAt, tickets as revenue.ts counts them', () => {
        expect(subWhere(base)).toEqual({ workspaceId: 'w1', isPaid: true, paidAt: RANGE })
        expect(ticketWhere(base)).toEqual({ workspaceId: 'w1', ...ticketsPaidInRangeWhere(RANGE) })
    })

    it('method, NONE and the marker filter every source', () => {
        const f = { ...base, method: 'CARD' as const, markedById: 'staff-1' }
        expect(subWhere(f)).toMatchObject({ paymentMethod: 'CARD', markedPaidById: 'staff-1' })
        expect(ticketWhere(f)).toMatchObject({ paymentMethod: 'CARD', markedPaidById: 'staff-1' })
        expect(subWhere({ ...base, method: 'NONE' }).paymentMethod).toBeNull()
        expect(ticketWhere({ ...base, method: 'NONE' }).paymentMethod).toBeNull()
    })

    it('«Со скидкой» compares the amount with the recorded list price; one discount; who priced it', () => {
        expect(subWhere({ ...base, discounted: true })).toMatchObject({
            listPrice: { not: null },
            amountPaid: { lt: 'Subscription.listPrice' },
        })
        expect(ticketWhere({ ...base, discounted: true })).toMatchObject({
            listPrice: { not: null },
            amountPaid: { lt: 'EventRegistration.listPrice' },
        })
        const f = { ...base, discountId: 'd1', pricedById: 'staff-3' }
        expect(subWhere(f)).toMatchObject({ discountId: 'd1', pricedById: 'staff-3' })
        expect(ticketWhere(f)).toMatchObject({ discountId: 'd1', pricedById: 'staff-3' })
        expect(subWhere(base)).not.toHaveProperty('amountPaid')
    })

    it('a scope narrows to current members of its groups; the whole club does not', () => {
        const scope = { groupIds: new Set(['g1']), includeGroupless: false }
        expect(subWhere({ ...base, scope }).workspaceMember).toEqual({
            user: { groupMemberships: { some: { groupId: { in: ['g1'] } } } },
        })
        expect(ticketWhere({ ...base, scope }).user).toEqual({
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
        expect(subWhere({ ...base, scope: club })).not.toHaveProperty('workspaceMember')
        expect(ticketWhere({ ...base, scope: club })).not.toHaveProperty('user')
    })

    it('search looks at the holder', () => {
        // One AND-ed condition per word, on the holder.
        expect(subWhere({ ...base, q: 'Иван Петров' })).toMatchObject({
            user: { AND: [expect.any(Object), expect.any(Object)] },
        })
        expect(ticketWhere({ ...base, q: 'Иван' })).toMatchObject({ user: { AND: [expect.any(Object)] } })
    })

    it('refunds of sales only (never of an unapplied payment), by refund date; their own method, the refunder', () => {
        expect(journalRefundWhere(base)).toEqual({
            workspaceId: 'w1',
            refundedAt: RANGE,
            OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }],
        })
        expect(journalRefundWhere({ ...base, method: 'CARD', markedById: 'staff-1' })).toMatchObject({
            method: 'CARD',
            createdById: 'staff-1',
        })
        expect(journalRefundWhere({ ...base, q: 'Иван' })).toMatchObject({ user: { AND: [expect.any(Object)] } })
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
                payment: { id: 'p1', provider: 'YOOKASSA', providerPaymentId: 'yk-00ab12cd', status: 'SUCCEEDED', amount: 4000, refundedAmount: 0 },
                refundedAmount: 1000,
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
            refundedAmount: 1000,
            reason: null,
            refundOf: null,
        })
    })

    it('a refund row: positive amount, its own method, who refunded, the reason and the sale it returns', () => {
        expect(refundJournalRow(refund('f1', '2026-11-12T09:00:00Z'))).toMatchObject({
            id: 'ref:f1',
            kind: 'refund',
            source: 'abonement',
            amount: 1000,
            method: 'CASH',
            markedById: 'staff-1',
            subscriptionId: 's1',
            refundedAmount: 0,
            reason: 'Пропустил две недели',
            refundOf: { id: 'sub:s1', at: new Date('2026-11-01T10:00:00Z'), amount: 4000 },
        })
        const ofTicket = refundJournalRow(
            refund('f2', '2026-11-12T09:00:00Z', {
                subscription: null,
                eventRegistration: { id: 'r1', eventId: 'e1', paidAt: null, createdAt: new Date('2026-11-02T00:00:00Z'), amountPaid: 1500 },
            }),
        )
        expect(ofTicket).toMatchObject({ source: 'ticket', eventRegistrationId: 'r1', eventId: 'e1', refundOf: { id: 'reg:r1', amount: 1500 } })
    })

    it('a legacy abonement without a holder column falls back to its membership', () => {
        const row = subscriptionJournalRow(sub('s1', '2026-11-03T11:40:00Z', { userId: null, user: null }))
        expect(row).toMatchObject({ userId: 'u1', person })
    })

    it('a ticket row: event currency when its own is missing; online only when paid online', () => {
        const online = { id: 'p2', provider: 'STRIPE', providerPaymentId: 'cs_1', status: 'SUCCEEDED', amount: 1500, refundedAmount: 0 }
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

    it('refunds merge in by refund date and count in the total', async () => {
        const prisma = prismaWith({ subs, tickets, refunds: [refund('f1', '2026-11-06T10:00:00Z')] })
        const page = await loadJournalPage(prisma as never, base, { curPage: 1, perPage: 4 })
        expect(page.rows.map((r) => r.id)).toEqual(['sub:s3', 'reg:r2', 'ref:f1', 'sub:s2'])
        expect(page.total).toBe(6)
        expect(prisma.refund.findMany.mock.calls[0][0]).toMatchObject({
            take: 4,
            orderBy: [{ refundedAt: 'desc' }, { id: 'desc' }],
            where: journalRefundWhere(base),
        })
    })

    it('«only refunds» reads refunds alone; «only payments» and «Не указан» read no refunds', async () => {
        const refunds = [refund('f1', '2026-11-06T10:00:00Z')]
        let prisma = prismaWith({ subs, tickets, refunds })
        expect(await loadJournalPage(prisma as never, { ...base, kind: 'refund' }, { curPage: 1, perPage: 50 })).toMatchObject({
            rows: [{ id: 'ref:f1' }],
            total: 1,
        })
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
        for (const f of [{ ...base, kind: 'payment' as const }, { ...base, method: 'NONE' as const }]) {
            prisma = prismaWith({ subs, tickets, refunds })
            expect((await loadJournalPage(prisma as never, f, { curPage: 1, perPage: 50 })).total).toBe(5)
            expect(prisma.refund.findMany).not.toHaveBeenCalled()
        }
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

const NONE_DISCOUNTED = { count: 0, amount: 0, oneOffAmount: 0 }

describe('totals', () => {
    it('per currency (dominant first) and method (fixed order); NONE for nothing recorded; empty methods left out', () => {
        expect(
            summarizeJournalTotals([
                { kind: 'payment', method: 'ONLINE', currency: 'RUB', amount: 5000, count: 1 },
                { kind: 'payment', method: null, currency: 'RUB', amount: 800, count: 1 },
                { kind: 'payment', method: 'CASH', currency: 'USD', amount: 50, count: 1 },
                { kind: 'payment', method: 'CASH', currency: 'RUB', amount: 3000, count: 2 },
                { kind: 'payment', method: 'CARD', currency: 'RUB', amount: 0, count: 0 },
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
                discounted: NONE_DISCOUNTED,
            },
            {
                currency: 'USD',
                received: 50,
                refunded: 0,
                net: 50,
                byMethod: [{ method: 'CASH', received: 50, refunded: 0, count: 1 }],
                discounted: NONE_DISCOUNTED,
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
        // The currency-less ticket's lookup; the discounted read finds nothing.
        prisma.eventRegistration.findMany.mockImplementation((async (args: { where: { AND?: unknown } }) =>
            args.where.AND ? [{ amountPaid: 1500, event: { currency: 'RUB' } }] : []) as never)
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
                discounted: NONE_DISCOUNTED,
            },
        ])
        expect(prisma.subscription.groupBy.mock.calls[0][0]).toMatchObject({
            by: ['paymentMethod', 'currency'],
            where: journalSubscriptionWhere(f, SUB_FIELDS),
        })
        expect(prisma.eventRegistration.groupBy.mock.calls[0][0].where).toEqual(journalTicketWhere(f, TICKET_FIELDS))
    })

    it('«Скидки»: Σ (list − paid) of the view’s discounted sales, its one-off part, per currency', async () => {
        const prisma = prismaWith()
        prisma.subscription.groupBy.mockResolvedValue([
            { paymentMethod: 'CASH', currency: 'RUB', _sum: { amountPaid: 7600 }, _count: { _all: 2 } },
        ])
        prisma.subscription.findMany.mockResolvedValue([
            // «Семейная» 400 on 4 000; a one-off 1 000 on 4 500 by the head coach.
            { listPrice: 4000, amountPaid: 3600, discountAmount: 400, currency: 'RUB' },
            { listPrice: 4500, amountPaid: 3500, discountAmount: 0, currency: 'RUB' },
        ] as never)
        const totals = await loadJournalTotals(prisma as never, { ...base, discounted: true })
        expect(totals[0]).toMatchObject({ net: 7600, discounted: { count: 2, amount: 1400, oneOffAmount: 1000 } })
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toMatchObject({
            listPrice: { not: null },
            amountPaid: { lt: 'Subscription.listPrice' },
        })
        // Refunds carry no discount: never read under a discount filter.
        expect(prisma.refund.groupBy).not.toHaveBeenCalled()
    })

    it('a refund counts as refunded under its own method, never as received, nor as a payment row', () => {
        expect(
            summarizeJournalTotals([
                { kind: 'payment', method: 'CASH', currency: 'RUB', amount: 4000, count: 1 },
                { kind: 'refund', method: 'CASH', currency: 'RUB', amount: 1000, count: 1 },
                { kind: 'refund', method: 'TRANSFER', currency: 'RUB', amount: 500, count: 1 },
            ]),
        ).toEqual([
            {
                currency: 'RUB',
                received: 4000,
                refunded: 1500,
                net: 2500,
                byMethod: [
                    { method: 'CASH', received: 4000, refunded: 1000, count: 1 },
                    { method: 'TRANSFER', received: 0, refunded: 500, count: 0 },
                ],
                discounted: NONE_DISCOUNTED,
            },
        ])
    })

    it('«only refunds» totals refunds alone, grouped by their method', async () => {
        const prisma = prismaWith()
        prisma.refund.groupBy.mockResolvedValue([
            { method: 'CASH', currency: 'RUB', _sum: { amount: 1000 }, _count: { _all: 1 } },
        ])
        expect(await loadJournalTotals(prisma as never, { ...base, kind: 'refund' })).toEqual([
            {
                currency: 'RUB',
                received: 0,
                refunded: 1000,
                net: -1000,
                byMethod: [{ method: 'CASH', received: 0, refunded: 1000, count: 0 }],
                discounted: NONE_DISCOUNTED,
            },
        ])
        expect(prisma.subscription.groupBy).not.toHaveBeenCalled()
        expect(prisma.refund.groupBy.mock.calls[0][0]).toMatchObject({ by: ['method', 'currency'], where: journalRefundWhere(base) })
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

    it('a discounted sale derives its named and one-off parts and names who priced it', async () => {
        const row = subscriptionJournalRow(
            sub('s1', '2026-11-03T00:00:00Z', {
                amountPaid: 2600,
                listPrice: 4000,
                discountId: 'd1',
                discountName: 'Семейная',
                discountAmount: 400,
                pricedById: 'coach-1',
            }),
        )
        expect(row).toMatchObject({ listPrice: 4000, discountName: 'Семейная', discount: { total: 1400, named: 400, oneOff: 1000 } })
        // A sale before discounts shows none, and its pricer is never asked for.
        const legacy = subscriptionJournalRow(sub('s2', '2026-11-03T00:00:00Z', { pricedById: 'coach-2' }))
        expect(legacy.discount).toEqual({ total: 0, named: 0, oneOff: 0 })
        const prisma = prismaWith()
        await loadJournalPeople(prisma as never, 'w1', [row, legacy])
        expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['staff-1', 'coach-1'] } })
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

    it('parses sub:/reg:/ref: ids; anything else is not an entry', () => {
        expect(parseJournalEntryId(`sub:${id}`)).toEqual({ source: 'abonement', id })
        expect(parseJournalEntryId(`reg:${id}`)).toEqual({ source: 'ticket', id })
        expect(parseJournalEntryId(`ref:${id}`)).toEqual({ source: 'refund', id })
        for (const bad of [`pay:${id}`, 'sub:nope', id, `sub:${id}:x`, '']) {
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

    it('loads a sale’s refund (never one of an unapplied payment)', async () => {
        const prisma = prismaWith()
        prisma.refund.findFirst.mockResolvedValue(refund(id, '2026-11-12T09:00:00Z'))
        expect(await loadJournalEntry(prisma as never, 'w1', `ref:${id}`)).toMatchObject({ id: `ref:${id}`, kind: 'refund' })
        expect(prisma.refund.findFirst.mock.calls[0][0].where).toEqual({
            id,
            workspaceId: 'w1',
            OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }],
        })
    })

    it('a sale’s refunds, newest first; a refund row has none', async () => {
        const prisma = prismaWith({ refunds: [refund('f2', '2026-11-12T09:00:00Z'), refund('f1', '2026-11-10T09:00:00Z')] })
        const row = subscriptionJournalRow(sub('s1', '2026-11-01T10:00:00Z'))
        expect((await loadSaleRefunds(prisma as never, 'w1', row)).map((r) => r.id)).toEqual(['ref:f2', 'ref:f1'])
        expect(prisma.refund.findMany.mock.calls[0][0]).toMatchObject({ where: { workspaceId: 'w1', subscriptionId: 's1' } })
        expect(await loadSaleRefunds(prisma as never, 'w1', refundJournalRow(refund('f1', '2026-11-10T09:00:00Z')))).toEqual([])
    })

    it('a full refund cancels only a live ticket of an event that has not started', async () => {
        const prisma = prismaWith()
        const row = ticketJournalRow(ticket('r1', '2026-11-03T00:00:00Z'))
        const reg = (status: string, startAt: string) => ({ status, event: { startAt: new Date(startAt) } })
        prisma.eventRegistration.findUnique.mockResolvedValueOnce(reg('BOOKED', '2026-11-20T10:00:00Z'))
        expect(await fullRefundCancelsRegistration(prisma as never, row, NOW)).toBe(true)
        prisma.eventRegistration.findUnique.mockResolvedValueOnce(reg('BOOKED', '2026-11-10T10:00:00Z'))
        expect(await fullRefundCancelsRegistration(prisma as never, row, NOW)).toBe(false)
        prisma.eventRegistration.findUnique.mockResolvedValueOnce(reg('CANCELLED', '2026-11-20T10:00:00Z'))
        expect(await fullRefundCancelsRegistration(prisma as never, row, NOW)).toBe(false)
        const abonement = subscriptionJournalRow(sub('s1', '2026-11-01T10:00:00Z'))
        expect(await fullRefundCancelsRegistration(prisma as never, abonement, NOW)).toBe(false)
        const refunded = ticketJournalRow(ticket('r1', '2026-11-03T00:00:00Z', { refundedAmount: 1500 }))
        expect(await fullRefundCancelsRegistration(prisma as never, refunded, NOW)).toBe(false)
        expect(prisma.eventRegistration.findUnique).toHaveBeenCalledTimes(3)
    })

    it('null for a malformed id or a row that is not a sale', async () => {
        const prisma = prismaWith()
        expect(await loadJournalEntry(prisma as never, 'w1', 'ref:x')).toBeNull()
        expect(await loadJournalEntry(prisma as never, 'w1', `ref:${id}`)).toBeNull()
        expect(prisma.subscription.findFirst).not.toHaveBeenCalled()
        expect(await loadJournalEntry(prisma as never, 'w1', `sub:${id}`)).toBeNull()
        expect(await loadJournalEntry(prisma as never, 'w1', `reg:${id}`)).toBeNull()
    })
})
