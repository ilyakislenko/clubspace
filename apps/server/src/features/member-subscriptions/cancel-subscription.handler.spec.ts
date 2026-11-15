import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { CancelSubscriptionFeature } from './cancel-subscription.feature'
import { CancelSubscriptionHandler } from './cancel-subscription.handler'

const NOW = new Date('2026-11-15T09:00:00Z')
const DAY = 24 * 60 * 60 * 1000

// One of the member's abonements as the autopay rules read it.
const abonement = (o: {
    id: string
    status?: string
    endDate?: Date
    directions?: string[]
    createdAt?: Date
}) => ({
    id: o.id,
    status: o.status ?? 'ACTIVE',
    startDate: new Date(NOW.getTime() - 10 * DAY),
    endDate: o.endDate ?? new Date(NOW.getTime() + 20 * DAY),
    classesTotal: null,
    classesRemaining: null,
    durationDays: 30,
    createdAt: o.createdAt ?? new Date(NOW.getTime() - 10 * DAY),
    updatedAt: NOW,
    directions: (o.directions ?? []).map((directionId) => ({ directionId })),
    consumedRecords: [],
})

const cancelledRow = {
    id: 's1',
    planId: 'p1',
    plan: { name: 'Безлимит' },
    status: 'CANCELLED',
    startDate: null,
    endDate: null,
    durationDays: 30,
    startsOnFirstVisit: false,
    amountPaid: 4000,
    currency: 'RUB',
    refundedAmount: 0,
    listPrice: 4000,
    discountId: null,
    discountName: null,
    discountAmount: 0,
    pricedById: null,
    isPaid: true,
    paidAt: NOW,
    paymentMethod: 'ONLINE',
    classesTotal: null,
    classesRemaining: null,
    source: 'GATEWAY',
    createdAt: NOW,
    directions: [],
}

const make = (o: {
    member?: boolean
    autopays?: unknown[]
    // The member's abonements after the cancel (what the rules judge).
    after?: unknown[]
} = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: true }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(o.member === false ? null : { id: 'm1' }),
        },
        subscription: {
            findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
            findMany: jest.fn().mockResolvedValue(o.after ?? []),
        },
        memberAutopay: { findMany: jest.fn().mockResolvedValue(o.autopays ?? []) },
    }
    const subscriptions = { cancel: jest.fn().mockResolvedValue(cancelledRow) }
    const realtime = { invalidate: jest.fn() }
    const agreements = { cancel: jest.fn().mockResolvedValue(null) }
    const handler = new CancelSubscriptionHandler(
        prisma as never,
        new RbacService(prisma as never),
        subscriptions as never,
        realtime as never,
        agreements as never,
    )
    const run = (caller: { userId?: string; role?: string | null } = {}) =>
        handler.execute(
            new CancelSubscriptionFeature(
                'w1',
                'u1',
                's1',
                caller.userId ?? 'adm',
                caller.role === undefined ? 'admin' : caller.role,
                false,
            ),
        )
    return { prisma, subscriptions, agreements, run }
}

const liveOn = (id: string, directions: string[]) => ({
    id,
    plan: { directions: directions.map((directionId) => ({ directionId })) },
})

beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
})
afterEach(() => {
    jest.useRealTimers()
})

describe('cancelSubscription', () => {
    it('refuses a coach and touches nothing', async () => {
        const m = make()
        await expect(m.run({ userId: 'c1', role: 'coach' })).rejects.toBeInstanceOf(ForbiddenError)
        expect(m.subscriptions.cancel).not.toHaveBeenCalled()
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })

    it('404s a non-member and an abonement of someone else', async () => {
        await expect(make({ member: false }).run()).rejects.toBeInstanceOf(NotFoundError)
        const m = make()
        m.prisma.subscription.findFirst.mockResolvedValueOnce(null)
        await expect(m.run()).rejects.toBeInstanceOf(NotFoundError)
        expect(m.subscriptions.cancel).not.toHaveBeenCalled()
    })

    it('cancels for the owner whatever their member row says', async () => {
        const m = make()
        await expect(m.run({ userId: 'owner', role: 'coach' })).resolves.toMatchObject({
            id: 's1',
            status: 'CANCELLED',
            paidByAutopay: false,
        })
        // No live agreement: the member's abonements are not even read.
        expect(m.prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    // docs/design/2026-11-15-member-autopay.md §3.5: nothing of that scope is
    // left to renew → the agreement stops (SYSTEM, with a notice).
    it('stops the autopay that would renew the cancelled abonement', async () => {
        const m = make({
            autopays: [liveOn('a1', []), liveOn('a2', ['bjj'])],
            after: [
                abonement({ id: 's1', status: 'CANCELLED' }),
                // Another scope, still current: its agreement keeps going.
                abonement({ id: 's2', directions: ['bjj'] }),
            ],
        })
        await m.run()
        expect(m.agreements.cancel).toHaveBeenCalledTimes(1)
        expect(m.agreements.cancel).toHaveBeenCalledWith({
            id: 'a1',
            source: 'SYSTEM',
            reason: 'абонемент отменён клубом',
            now: NOW,
        })
        expect(m.prisma.memberAutopay.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'u1',
            status: { in: ['ACTIVE', 'NEEDS_ACTION'] },
        })
        expect(m.prisma.subscription.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceMemberId: 'm1',
        })
    })

    it('keeps the autopay when another abonement of that scope is still current', async () => {
        const m = make({
            autopays: [liveOn('a1', [])],
            after: [
                abonement({ id: 's1', status: 'CANCELLED', createdAt: NOW }),
                abonement({ id: 's0' }),
            ],
        })
        await m.run()
        expect(m.agreements.cancel).not.toHaveBeenCalled()
    })
})
