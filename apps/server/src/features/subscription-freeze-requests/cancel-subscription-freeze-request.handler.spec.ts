import { CancelSubscriptionFreezeRequestFeature } from './cancel-subscription-freeze-request.feature'
import { CancelSubscriptionFreezeRequestHandler } from './cancel-subscription-freeze-request.handler'

const row = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    subscriptionId: 's1',
    userId: 'me',
    status: 'PENDING',
    fromDate: new Date('2026-10-28T00:00:00Z'),
    days: 7,
    reason: 'Травма',
    decisionComment: null,
    decidedAt: null,
    decidedBy: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
    ...over,
})

const build = (
    first: unknown,
    o: { count?: number; fresh?: unknown } = {},
) => {
    const prisma = {
        subscriptionFreezeRequest: {
            findFirst: jest.fn().mockResolvedValue(first),
            updateMany: jest.fn().mockResolvedValue({ count: o.count ?? 1 }),
            findFirstOrThrow: jest
                .fn()
                .mockResolvedValue(o.fresh ?? row({ status: 'CANCELLED' })),
        },
    }
    const realtime = { invalidate: jest.fn() }
    const handler = new CancelSubscriptionFreezeRequestHandler(
        prisma as never,
        realtime as never,
    )
    return { handler, prisma, realtime }
}

const feature = () =>
    new CancelSubscriptionFreezeRequestFeature('w1', 'r1', 'me')

describe('CancelSubscriptionFreezeRequestHandler', () => {
    it('scopes the lookup to the caller, so another member\'s request is 404', async () => {
        const { handler, prisma } = build(null)
        await expect(handler.execute(feature())).rejects.toThrow(/не найдена/)
        expect(prisma.subscriptionFreezeRequest.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'r1', workspaceId: 'w1', userId: 'me' },
            }),
        )
    })

    it('is idempotent on an already cancelled request', async () => {
        const { handler, prisma, realtime } = build(row({ status: 'CANCELLED' }))
        const out = await handler.execute(feature())
        expect(out.status).toBe('CANCELLED')
        expect(prisma.subscriptionFreezeRequest.updateMany).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it.each(['APPROVED', 'DECLINED'])('refuses a %s request with 409', async (status) => {
        const { handler } = build(row({ status }))
        await expect(handler.execute(feature())).rejects.toThrow(
            /уже рассмотрели/,
        )
    })

    it('claims PENDING and frees the pending slot', async () => {
        const { handler, prisma, realtime } = build(row())
        const out = await handler.execute(feature())
        expect(prisma.subscriptionFreezeRequest.updateMany).toHaveBeenCalledWith({
            where: { id: 'r1', status: 'PENDING' },
            data: { status: 'CANCELLED', pendingSubscriptionId: null },
        })
        expect(out.status).toBe('CANCELLED')
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', [
            'subscription',
            'freeze-requests',
        ])
    })

    it('answers 409 when the coach decided first', async () => {
        const { handler, realtime } = build(row(), {
            count: 0,
            fresh: row({ status: 'APPROVED' }),
        })
        await expect(handler.execute(feature())).rejects.toThrow(
            /уже рассмотрели/,
        )
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('returns the request when a parallel cancel won the race', async () => {
        const { handler } = build(row(), {
            count: 0,
            fresh: row({ status: 'CANCELLED' }),
        })
        await expect(handler.execute(feature())).resolves.toMatchObject({
            status: 'CANCELLED',
        })
    })
})
