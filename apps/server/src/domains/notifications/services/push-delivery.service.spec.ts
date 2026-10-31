import { NO_DEVICE_ERROR, PushDeliveryService } from './push-delivery.service'

const NOW = new Date('2026-05-08T12:00:00Z')

const row = (id: string, userId: string) => ({
    id,
    userId,
    topic: `topic ${id}`,
    message: `body ${id}`,
    link: null,
    metadata: { kind: 'k', workspaceId: 'w1' },
})

const build = (opts: {
    claimed?: ReturnType<typeof row>[]
    devices?: { userId: string; token: string }[]
    send?: jest.Mock
    receipts?: Record<string, unknown>
}) => {
    const prisma = {
        notification: {
            updateManyAndReturn: jest.fn().mockResolvedValue(opts.claimed ?? []),
            updateMany: jest.fn((args: unknown) => ({ op: 'updateMany', args })),
            findMany: jest.fn().mockResolvedValue([]),
        },
        firebaseDevice: {
            findMany: jest.fn().mockResolvedValue(opts.devices ?? []),
            deleteMany: jest.fn((args: unknown) => ({ op: 'deleteMany', args })),
        },
        $transaction: jest.fn().mockResolvedValue([]),
    }
    const expo = {
        send:
            opts.send ??
            jest.fn(async (messages: unknown[]) =>
                messages.map((_, i) => ({ status: 'ok', id: `t${i}` })),
            ),
        getReceipts: jest.fn().mockResolvedValue(opts.receipts ?? {}),
    }
    const service = new PushDeliveryService(prisma as never, expo as never)
    // Every write the call batched into its final transaction.
    const writes = () =>
        (prisma.$transaction.mock.calls[0]?.[0] ?? []) as {
            op: string
            args: { where: Record<string, unknown>; data?: Record<string, unknown> }
        }[]
    return { service, prisma, expo, writes }
}

describe('PushDeliveryService.deliver', () => {
    it('does nothing for an empty id list', async () => {
        const { service, prisma } = build({})
        expect(await service.deliver([], NOW)).toEqual({
            delivered: 0,
            retry: 0,
            tickets: [],
        })
        expect(prisma.notification.updateManyAndReturn).not.toHaveBeenCalled()
    })

    it('claims only pending PUSH rows inside the age window, atomically', async () => {
        const { service, prisma, expo } = build({ claimed: [] })
        const res = await service.deliver(['n1', 'n2'], NOW)
        expect(res.delivered).toBe(0)
        const args = prisma.notification.updateManyAndReturn.mock.calls[0][0]
        expect(args.where).toMatchObject({
            id: { in: ['n1', 'n2'] },
            type: 'PUSH',
            sent: false,
        })
        expect(args.where.createdAt.gte.getTime()).toBe(
            NOW.getTime() - 3 * 24 * 60 * 60 * 1000,
        )
        expect(args.data).toEqual({ sent: true, sentAt: NOW })
        // A duplicate job found nothing left to claim: no send at all.
        expect(expo.send).not.toHaveBeenCalled()
    })

    it('sends one message per device and stores only the ticket ids', async () => {
        const { service, expo, writes } = build({
            claimed: [row('n1', 'u1')],
            devices: [
                { userId: 'u1', token: 'tokA' },
                { userId: 'u1', token: 'tokB' },
            ],
        })
        const res = await service.deliver(['n1'], NOW)

        expect(res).toEqual({
            delivered: 1,
            retry: 0,
            tickets: [
                { id: 't0', token: 'tokA' },
                { id: 't1', token: 'tokB' },
            ],
        })
        const messages = expo.send.mock.calls[0][0]
        expect(messages.map((m: { to: string }) => m.to)).toEqual(['tokA', 'tokB'])
        expect(messages[0]).toMatchObject({
            title: 'topic n1',
            body: 'body n1',
            data: { notificationId: 'n1', kind: 'k', workspaceId: 'w1' },
        })
        expect(writes()).toEqual([
            {
                op: 'updateMany',
                args: {
                    where: { id: 'n1' },
                    data: { sentPayload: { ticketIds: ['t0', 't1'] }, error: null },
                },
            },
        ])
    })

    it('batches many rows into requests of at most 100 messages, never splitting a row', async () => {
        const claimed = Array.from({ length: 60 }, (_, i) => row(`n${i}`, `u${i}`))
        const devices = claimed.flatMap((r) => [
            { userId: r.userId, token: `${r.userId}-a` },
            { userId: r.userId, token: `${r.userId}-b` },
        ])
        const { service, expo } = build({ claimed, devices })

        const res = await service.deliver(claimed.map((r) => r.id), NOW)

        expect(res.delivered).toBe(60)
        const sizes = expo.send.mock.calls.map((c) => c[0].length)
        expect(sizes).toEqual([100, 20])
    })

    it('marks a row for a user without devices as done, with the reason', async () => {
        const { service, expo, writes } = build({ claimed: [row('n1', 'u1')] })
        const res = await service.deliver(['n1'], NOW)
        expect(res.delivered).toBe(0)
        expect(expo.send).not.toHaveBeenCalled()
        expect(writes()).toEqual([
            {
                op: 'updateMany',
                args: {
                    where: { id: { in: ['n1'] } },
                    data: { error: NO_DEVICE_ERROR },
                },
            },
        ])
    })

    it('drops dead tokens and does not retry when every failure is final', async () => {
        const send = jest.fn().mockResolvedValue([
            {
                status: 'error',
                message: 'not registered',
                details: { error: 'DeviceNotRegistered' },
            },
        ])
        const { service, writes } = build({
            claimed: [row('n1', 'u1')],
            devices: [{ userId: 'u1', token: 'dead' }],
            send,
        })
        const res = await service.deliver(['n1'], NOW)
        expect(res).toMatchObject({ delivered: 0, retry: 0 })
        expect(writes()).toEqual([
            {
                op: 'updateMany',
                args: { where: { id: 'n1' }, data: { error: 'not registered' } },
            },
            { op: 'deleteMany', args: { where: { token: { in: ['dead'] } } } },
        ])
    })

    it('puts a rate-limited row back to pending and reports it for retry', async () => {
        const send = jest.fn().mockResolvedValue([
            {
                status: 'error',
                message: 'slow down',
                details: { error: 'MessageRateExceeded' },
            },
        ])
        const { service, writes } = build({
            claimed: [row('n1', 'u1')],
            devices: [{ userId: 'u1', token: 'tok' }],
            send,
        })
        const res = await service.deliver(['n1'], NOW)
        expect(res.retry).toBe(1)
        expect(writes()).toEqual([
            {
                op: 'updateMany',
                args: {
                    where: { id: 'n1' },
                    data: { sent: false, sentAt: null, error: 'slow down' },
                },
            },
        ])
    })

    it('reverts only the rows of a failed request; other batches still go out', async () => {
        const claimed = Array.from({ length: 101 }, (_, i) => row(`n${i}`, `u${i}`))
        const devices = claimed.map((r) => ({ userId: r.userId, token: r.userId }))
        const send = jest
            .fn()
            .mockRejectedValueOnce(new Error('ETIMEDOUT'))
            .mockImplementation(async (messages: unknown[]) =>
                messages.map((_, i) => ({ status: 'ok', id: `t${i}` })),
            )
        const { service, writes } = build({ claimed, devices, send })

        const res = await service.deliver(claimed.map((r) => r.id), NOW)

        expect(res).toMatchObject({ delivered: 1, retry: 100 })
        const reverted = writes().filter((w) => w.args.data?.sent === false)
        expect(reverted).toHaveLength(100)
        expect(reverted[0].args.data).toEqual({
            sent: false,
            sentAt: null,
            error: 'ETIMEDOUT',
        })
    })
})

describe('PushDeliveryService.findStalePending', () => {
    it('reads pending rows past the grace period and inside the age window', async () => {
        const { service, prisma } = build({})
        prisma.notification.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])

        expect(await service.findStalePending(NOW)).toEqual(['a', 'b'])

        const args = prisma.notification.findMany.mock.calls[0][0]
        expect(args.where).toMatchObject({ type: 'PUSH', sent: false })
        expect(args.where.createdAt.lte.getTime()).toBe(NOW.getTime() - 2 * 60_000)
        expect(args.orderBy).toEqual({ createdAt: 'asc' })
        expect(args.take).toBe(1000)
    })
})

describe('PushDeliveryService.pruneFromReceipts', () => {
    it('deletes the tokens whose receipt says the app is gone', async () => {
        const { service, prisma, expo } = build({
            receipts: {
                t1: { status: 'ok' },
                t2: {
                    status: 'error',
                    message: 'gone',
                    details: { error: 'DeviceNotRegistered' },
                },
                t3: { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
            },
        })
        prisma.firebaseDevice.deleteMany.mockReturnValue(
            Promise.resolve({ count: 1 }) as never,
        )

        const removed = await service.pruneFromReceipts([
            { id: 't1', token: 'a' },
            { id: 't2', token: 'b' },
            { id: 't3', token: 'c' },
            { id: 't4', token: 'd' }, // receipt not ready yet
        ])

        expect(removed).toBe(1)
        expect(expo.getReceipts).toHaveBeenCalledWith(['t1', 't2', 't3', 't4'])
        expect(prisma.firebaseDevice.deleteMany).toHaveBeenCalledWith({
            where: { token: { in: ['b'] } },
        })
    })

    it('makes no request for an empty list and deletes nothing when all are fine', async () => {
        const { service, prisma, expo } = build({ receipts: { t1: { status: 'ok' } } })
        expect(await service.pruneFromReceipts([])).toBe(0)
        expect(expo.getReceipts).not.toHaveBeenCalled()
        expect(await service.pruneFromReceipts([{ id: 't1', token: 'a' }])).toBe(0)
        expect(prisma.firebaseDevice.deleteMany).not.toHaveBeenCalled()
    })
})
