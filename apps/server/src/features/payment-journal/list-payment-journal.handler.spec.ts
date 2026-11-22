import { revenueWindowStart } from '../../domains/metrics/revenue'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ListPaymentJournalFeature } from './list-payment-journal.feature'
import { ListPaymentJournalHandler } from './list-payment-journal.handler'

const OWNER_ID = 'owner-1'
const G1 = '7a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d'

// Resolves the scope the way RbacService does: owner, admin and head coach
// run every group; only the caller decides who is a club admin.
const rbac = () => ({
    resolveCoachScope: jest.fn(async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
        scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: OWNER_ID,
    })),
    canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
})

type Caller = { userId: string; roleName: string }
const ADMIN: Caller = { userId: 'a-1', roleName: 'admin' }
// The owner has no member row: whatever role the token carries, they pass.
const OWNER: Caller = { userId: OWNER_ID, roleName: 'user' }

const person = { firstname: 'Иван', lastname: 'Петров', email: 'ivan@x.ru' }
const sub = {
    id: 's1',
    paidAt: new Date('2026-11-03T11:40:00Z'),
    createdAt: new Date('2026-11-03T11:40:00Z'),
    amountPaid: 4000,
    refundedAmount: 1000,
    currency: 'RUB',
    paymentMethod: 'CASH',
    markedPaidById: 'coach-1',
    classesTotal: 12,
    userId: 'u1',
    plan: { name: 'БЖЖ 12' },
    user: person,
    workspaceMember: { userId: 'u1', user: person },
    payment: null,
}
const unapplied = {
    id: 'p9',
    paidAt: new Date('2026-11-02T08:00:00Z'),
    createdAt: new Date('2026-11-02T07:59:00Z'),
    userId: 'u3',
    user: { firstname: 'Ольга', lastname: null, email: null },
    planName: 'Безлимит',
    amount: 6000,
    refundedAmount: 0,
    currency: 'RUB',
    provider: 'YOOKASSA',
    activationError: 'У участника уже есть абонемент',
}

const refund = {
    id: 'f1',
    refundedAt: new Date('2026-11-05T09:00:00Z'),
    amount: 1000,
    currency: 'RUB',
    method: 'CASH',
    reason: 'Пропустил две недели',
    createdById: 'coach-1',
    userId: 'u1',
    itemName: 'БЖЖ 12',
    user: person,
    subscription: { id: 's1', paidAt: new Date('2026-11-03T11:40:00Z'), createdAt: new Date('2026-11-03T11:40:00Z'), amountPaid: 4000 },
    eventRegistration: null,
    payment: null,
}

const setup = () => ({
    refund: {
        findMany: jest.fn().mockResolvedValue([refund]),
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockResolvedValue([
            { method: 'CASH', currency: 'RUB', _sum: { amount: 1000 }, _count: { _all: 1 } },
        ]),
    },
    workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }) },
    subscription: {
        findMany: jest.fn().mockResolvedValue([sub]),
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockResolvedValue([
            { paymentMethod: 'CASH', currency: 'RUB', _sum: { amountPaid: 4000 }, _count: { _all: 1 } },
        ]),
    },
    eventRegistration: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
    },
    payment: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([unapplied]),
    },
    user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'coach-1', firstname: 'Пётр', lastname: 'Тренер', email: null }]),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }]) },
    group: {
        findFirst: jest.fn().mockResolvedValue({ id: G1 }),
        findMany: jest.fn().mockResolvedValue([{ id: G1 }]),
    },
    gym: { findFirst: jest.fn() },
    direction: { findFirst: jest.fn() },
    groupCoach: { findFirst: jest.fn() },
})

const run = (
    caller: Caller,
    payload: ConstructorParameters<typeof ListPaymentJournalFeature>[0] = {},
    prisma = setup(),
) => ({
    prisma,
    out: new ListPaymentJournalHandler(prisma as never, rbac() as never).execute(
        new ListPaymentJournalFeature(payload, 'w1', caller.userId, caller.roleName, false),
    ),
})

describe('listPaymentJournal', () => {
    it.each([
        ['a head coach (runs every group, but not the money)', { userId: 'hc-1', roleName: 'head_coach' }],
        ['a coach', { userId: 'c-1', roleName: 'coach' }],
        // A direction manager is a coach with DirectionManager rows.
        ['a direction manager', { userId: 'dm-1', roleName: 'coach' }],
    ])('refuses %s before reading anything', async (_, caller) => {
        const { prisma, out } = run(caller)
        await expect(out).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
        expect(prisma.payment.findMany).not.toHaveBeenCalled()
    })

    it.each([
        ['an admin', ADMIN],
        ['the owner', OWNER],
    ])('shows the journal to %s', async (_, caller) => {
        await expect(run(caller).out).resolves.toMatchObject({ total: 2 })
    })

    it('no dates = the revenue_30d window', async () => {
        const before = Date.now()
        const { prisma, out } = run(ADMIN)
        await out
        const where = prisma.subscription.findMany.mock.calls[0][0].where
        const gte: Date = where.paidAt.gte
        expect(where.paidAt.lte).toBeUndefined()
        expect(gte.getTime()).toBeGreaterThanOrEqual(revenueWindowStart(new Date(before)).getTime())
        expect(gte.getTime()).toBeLessThanOrEqual(revenueWindowStart(new Date()).getTime())
        // Tickets read the same window.
        expect(prisma.eventRegistration.findMany.mock.calls[0][0].where.paidAt).toEqual(where.paidAt)
    })

    it('dates are club-local days', async () => {
        const { prisma, out } = run(ADMIN, { from: '2026-11-01', to: '2026-11-30' })
        await out
        expect(prisma.subscription.findMany.mock.calls[0][0].where.paidAt).toEqual({
            gte: new Date('2026-10-31T17:00:00.000Z'),
            lte: new Date('2026-11-30T16:59:59.999Z'),
        })
    })

    it.each([
        [{ from: '2026-11-01' }],
        [{ from: '2026-11-02', to: '2026-11-01' }],
        [{ from: '2025-01-01', to: '2026-11-01' }],
    ])('refuses the period %j with a 400', async (payload) => {
        const { prisma, out } = run(ADMIN, payload)
        await expect(out).rejects.toMatchObject({ statusCode: 400 })
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('a group of another club is a 404', async () => {
        const prisma = setup()
        prisma.group.findFirst.mockResolvedValue(null)
        const { out } = run(ADMIN, { groupId: G1 }, prisma)
        await expect(out).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('filters narrow rows and totals alike', async () => {
        const { prisma, out } = run(ADMIN, { groupId: G1, method: 'CASH', markedById: 'coach-1', q: ' Иван ' })
        await out
        const rows = prisma.subscription.findMany.mock.calls[0][0].where
        expect(rows).toMatchObject({
            paymentMethod: 'CASH',
            markedPaidById: 'coach-1',
            workspaceMember: { user: { groupMemberships: { some: { groupId: { in: [G1] } } } } },
            user: { AND: [expect.any(Object)] },
        })
        expect(prisma.subscription.groupBy.mock.calls[0][0].where).toEqual(rows)
        expect(prisma.subscription.count.mock.calls[0][0].where).toEqual(rows)
    })

    it('maps the rows, the totals and, on page 1, the unapplied strip', async () => {
        const out = await run(ADMIN).out
        expect(out).toMatchObject({ total: 2, curPage: 1, perPage: 50 })
        expect(out.data.map((r) => r.id)).toEqual(['ref:f1', 'sub:s1'])
        expect(out.data[0]).toEqual({
            id: 'ref:f1',
            kind: 'refund',
            source: 'abonement',
            at: '2026-11-05T09:00:00.000Z',
            amount: 1000,
            currency: 'RUB',
            method: 'CASH',
            member: { userId: 'u1', name: 'Иван Петров', isMember: true },
            itemName: 'БЖЖ 12',
            subscriptionId: 's1',
            eventRegistrationId: null,
            eventId: null,
            markedBy: { userId: 'coach-1', name: 'Пётр Тренер' },
            refundedAmount: 0,
            refundable: 0,
            online: null,
            reason: 'Пропустил две недели',
            refundOf: { id: 'sub:s1', at: '2026-11-03T11:40:00.000Z', amount: 4000 },
        })
        expect(out.data[1]).toEqual({
            id: 'sub:s1',
            kind: 'payment',
            source: 'abonement',
            at: '2026-11-03T11:40:00.000Z',
            amount: 4000,
            currency: 'RUB',
            method: 'CASH',
            member: { userId: 'u1', name: 'Иван Петров', isMember: true },
            itemName: 'БЖЖ 12',
            subscriptionId: 's1',
            eventRegistrationId: null,
            eventId: null,
            markedBy: { userId: 'coach-1', name: 'Пётр Тренер' },
            refundedAmount: 1000,
            refundable: 3000,
            online: null,
            reason: null,
            refundOf: null,
        })
        expect(out.totals).toEqual([
            {
                currency: 'RUB',
                received: 4000,
                refunded: 1000,
                net: 3000,
                byMethod: [{ method: 'CASH', received: 4000, refunded: 1000, count: 1 }],
            },
        ])
        expect(out.unapplied).toEqual({
            total: 1,
            data: [
                {
                    paymentId: 'p9',
                    at: '2026-11-02T08:00:00.000Z',
                    member: { userId: 'u3', name: 'Ольга', isMember: false },
                    itemName: 'Безлимит',
                    amount: 6000,
                    refundable: 6000,
                    currency: 'RUB',
                    provider: 'YOOKASSA',
                    activationError: 'У участника уже есть абонемент',
                },
            ],
        })
    })

    it('tells whether a strip buyer is a member now, in the rows’ membership query', async () => {
        const prisma = setup()
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u3' }])
        const out = await run(ADMIN, {}, prisma).out
        expect(out.unapplied?.data[0].member).toEqual({ userId: 'u3', name: 'Ольга', isMember: true })
        expect(prisma.workspaceMember.findMany).toHaveBeenCalledTimes(1)
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['u1', 'u3'] },
        })
    })

    it('the strip ignores the filters and stays off later pages', async () => {
        const first = run(ADMIN, { method: 'TRANSFER' })
        await first.out
        expect(first.prisma.payment.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: 'SUCCEEDED',
            activationError: { not: null },
        })
        const second = run(ADMIN, { curPage: 2, perPage: 20 })
        expect(await second.out).toMatchObject({ unapplied: null, curPage: 2, perPage: 20 })
        expect(second.prisma.payment.findMany).not.toHaveBeenCalled()
    })

    it('refuses a page past the depth cap', async () => {
        await expect(run(ADMIN, { curPage: 26, perPage: 200 }).out).rejects.toThrow(/Слишком далеко/)
    })
})
