import { addDaysYmd } from '../../domains/subscriptions/freeze-dates'
import { RequestSubscriptionFreezeFeature } from './request-subscription-freeze.feature'
import { RequestSubscriptionFreezeHandler } from './request-subscription-freeze.handler'

const DAY = 24 * 3600 * 1000
const today = new Date().toISOString().slice(0, 10)
const tomorrow = addDaysYmd(today, 1)

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    status: 'ACTIVE',
    startDate: new Date(Date.now() - 5 * DAY),
    endDate: new Date(Date.now() + 30 * DAY),
    classesRemaining: null as number | null,
    plan: { name: 'Месяц' },
    ...over,
})

const created = () => ({
    id: 'r1',
    subscriptionId: 's1',
    userId: 'me',
    status: 'PENDING',
    fromDate: new Date(`${tomorrow}T00:00:00Z`),
    days: 7,
    reason: 'Травма',
    decisionComment: null,
    decidedAt: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
})

const build = (
    o: {
        member?: unknown
        sub?: unknown
        open?: unknown
        createError?: unknown
        deciders?: string[]
    } = {},
) => {
    const prisma = {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                o.member === undefined
                    ? {
                          id: 'wm1',
                          subscriptionId: 's1',
                          user: {
                              firstname: 'Анна',
                              lastname: 'Ким',
                              email: 'a@x',
                          },
                          workspace: { timezone: 'UTC', ownerId: 'owner' },
                      }
                    : o.member,
            ),
            findMany: jest
                .fn()
                .mockResolvedValue((o.deciders ?? ['adm']).map((userId) => ({ userId }))),
        },
        groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
        subscription: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.sub === undefined ? subRow() : o.sub),
        },
        subscriptionFreeze: {
            findFirst: jest.fn().mockResolvedValue(o.open ?? null),
        },
        subscriptionFreezeRequest: {
            create: o.createError
                ? jest.fn().mockRejectedValue(o.createError)
                : jest.fn().mockResolvedValue(created()),
        },
    }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const handler = new RequestSubscriptionFreezeHandler(
        prisma as never,
        notifications as never,
        realtime as never,
    )
    return { handler, prisma, notifications, realtime }
}

const feature = (over: Record<string, unknown> = {}) =>
    new RequestSubscriptionFreezeFeature(
        { fromDate: tomorrow, days: 7, reason: 'Травма', ...over },
        'w1',
        'me',
    )

describe('RequestSubscriptionFreezeHandler', () => {
    it('answers 404 for the owner, who has no member row', async () => {
        const { handler } = build({ member: null })
        await expect(handler.execute(feature())).rejects.toThrow(
            /Абонемент не найден/,
        )
    })

    it('refuses a member without a pointer', async () => {
        const { handler } = build({
            member: {
                id: 'wm1',
                subscriptionId: null,
                user: { firstname: null, lastname: null, email: 'a@x' },
                workspace: { timezone: 'UTC', ownerId: 'owner' },
            },
        })
        await expect(handler.execute(feature())).rejects.toThrow(
            /нет действующего абонемента/,
        )
    })

    it('refuses an expired pointer (the pointer outlives the row)', async () => {
        const { handler, prisma } = build({
            sub: subRow({ endDate: new Date(Date.now() - DAY) }),
        })
        await expect(handler.execute(feature())).rejects.toThrow(
            /нет действующего абонемента/,
        )
        expect(prisma.subscriptionFreezeRequest.create).not.toHaveBeenCalled()
    })

    it('reads the abonement only through the member pointer', async () => {
        const { handler, prisma } = build()
        await handler.execute(feature())
        expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: 's1',
                    workspaceId: 'w1',
                    workspaceMemberId: 'wm1',
                },
            }),
        )
    })

    it('says a first-visit abonement has not started', async () => {
        const { handler } = build({ sub: subRow({ startDate: null }) })
        await expect(handler.execute(feature())).rejects.toThrow(
            /ещё не начался/,
        )
    })

    it('refuses a pack with no classes left', async () => {
        const { handler } = build({ sub: subRow({ classesRemaining: 0 }) })
        await expect(handler.execute(feature())).rejects.toThrow(
            /не осталось занятий/,
        )
    })

    it('refuses a start in the past', async () => {
        const { handler } = build()
        await expect(
            handler.execute(feature({ fromDate: addDaysYmd(today, -2) })),
        ).rejects.toThrow(/в прошлом/)
    })

    it('refuses while a freeze is open', async () => {
        const { handler } = build({
            open: {
                fromDate: new Date('2026-10-24T00:00:00Z'),
                untilDate: new Date('2026-10-30T00:00:00Z'),
            },
        })
        await expect(handler.execute(feature())).rejects.toThrow(
            /уже есть заморозка/,
        )
    })

    it('answers 409 when a request is already pending (unique slot)', async () => {
        const { handler, notifications } = build({
            createError: Object.assign(new Error('dup'), { code: 'P2002' }),
        })
        await expect(handler.execute(feature())).rejects.toThrow(
            /уже отправили заявку/,
        )
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('rethrows an unexpected create failure', async () => {
        const { handler } = build({ createError: new Error('db down') })
        await expect(handler.execute(feature())).rejects.toThrow(/db down/)
    })

    it('creates the request holding the pending slot, refreshes and notifies the deciders', async () => {
        const { handler, prisma, realtime, notifications } = build({
            deciders: ['adm', 'me', 'coach'],
        })
        const out = await handler.execute(feature())

        expect(prisma.subscriptionFreezeRequest.create).toHaveBeenCalledWith({
            data: {
                workspaceId: 'w1',
                subscriptionId: 's1',
                userId: 'me',
                pendingSubscriptionId: 's1',
                fromDate: new Date(`${tomorrow}T00:00:00Z`),
                days: 7,
                reason: 'Травма',
            },
        })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'subscription',
            'freeze-requests',
        ])
        const recipients = notifications.notifyUser.mock.calls.map(
            (c: any[]) => c[0].userId,
        )
        expect(recipients).toEqual(['owner', 'adm', 'coach'])
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            kind: 'freeze.requested',
            refId: 'r1:requested:owner',
            feature: 'subscription',
            workspaceId: 'w1',
            metadata: {
                workspaceId: 'w1',
                freezeRequestId: 'r1',
                memberUserId: 'me',
            },
        })
        expect(out).toMatchObject({
            id: 'r1',
            status: 'PENDING',
            fromDate: tomorrow,
            days: 7,
            decidedByName: null,
        })
    })

    it('still succeeds when notifying fails', async () => {
        const { handler, notifications, prisma } = build()
        notifications.notifyUser.mockRejectedValue(new Error('push down'))
        await expect(handler.execute(feature())).resolves.toMatchObject({
            id: 'r1',
        })
        prisma.workspaceMember.findMany.mockRejectedValue(new Error('db'))
        await expect(handler.execute(feature())).resolves.toMatchObject({
            id: 'r1',
        })
    })
})
