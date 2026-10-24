import { PushDeliveryService } from './push-delivery.service'

type Row = {
    id: string
    userId: string
    topic: string
    message: string
    link: string | null
    metadata: unknown
}

const build = (opts: {
    pending: Row[]
    devicesByUser: Record<string, string[]>
    send: jest.Mock
}) => {
    const prisma = {
        notification: {
            findMany: jest.fn().mockResolvedValue(opts.pending),
            update: jest.fn().mockResolvedValue({}),
        },
        firebaseDevice: {
            findMany: jest.fn(({ where }: { where: { userId: string } }) =>
                Promise.resolve(
                    (opts.devicesByUser[where.userId] ?? []).map((token) => ({
                        token,
                    })),
                ),
            ),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    }
    const expo = { send: opts.send }
    const service = new PushDeliveryService(prisma as never, expo as never)
    return { service, prisma, expo }
}

const row = (over: Partial<Row> = {}): Row => ({
    id: 'n1',
    userId: 'u1',
    topic: 'Topic',
    message: 'Body',
    link: null,
    metadata: null,
    ...over,
})

describe('PushDeliveryService.deliverPending', () => {
    it('returns 0 and sends nothing when there is no backlog', async () => {
        const send = jest.fn()
        const { service } = build({ pending: [], devicesByUser: {}, send })

        expect(await service.deliverPending()).toBe(0)
        expect(send).not.toHaveBeenCalled()
    })

    it('delivers to every device token and marks the row sent', async () => {
        const send = jest.fn().mockResolvedValue([
            { status: 'ok', id: 't1' },
            { status: 'ok', id: 't2' },
        ])
        const { service, prisma } = build({
            pending: [row()],
            devicesByUser: { u1: ['tokA', 'tokB'] },
            send,
        })

        const delivered = await service.deliverPending()

        expect(delivered).toBe(1)
        expect(send).toHaveBeenCalledTimes(1)
        expect(send.mock.calls[0][0]).toHaveLength(2)
        expect(prisma.notification.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'n1' },
                data: expect.objectContaining({ sent: true }),
            }),
        )
    })

    it('skips rows for users with no registered device (leaves unsent)', async () => {
        const send = jest.fn()
        const { service, prisma } = build({
            pending: [row()],
            devicesByUser: {},
            send,
        })

        expect(await service.deliverPending()).toBe(0)
        expect(send).not.toHaveBeenCalled()
        expect(prisma.notification.update).not.toHaveBeenCalled()
    })

    it('prunes dead tokens and still marks the row sent when all failures are pruned', async () => {
        const send = jest.fn().mockResolvedValue([
            {
                status: 'error',
                message: 'gone',
                details: { error: 'DeviceNotRegistered' },
            },
        ])
        const { service, prisma } = build({
            pending: [row()],
            devicesByUser: { u1: ['deadTok'] },
            send,
        })

        const delivered = await service.deliverPending()

        // No device actually received it, so it's not counted as delivered…
        expect(delivered).toBe(0)
        // …but the dead token is pruned and the row is marked sent (retrying is futile).
        expect(prisma.firebaseDevice.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', token: { in: ['deadTok'] } },
        })
        expect(prisma.notification.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ sent: true }),
            }),
        )
    })

    it('leaves the row unsent on a transient per-message error', async () => {
        const send = jest.fn().mockResolvedValue([
            { status: 'error', message: 'MessageRateExceeded', details: {} },
        ])
        const { service, prisma } = build({
            pending: [row()],
            devicesByUser: { u1: ['tokA'] },
            send,
        })

        const delivered = await service.deliverPending()

        expect(delivered).toBe(0)
        expect(prisma.firebaseDevice.deleteMany).not.toHaveBeenCalled()
        // recorded the error but did NOT mark sent
        expect(prisma.notification.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.not.objectContaining({ sent: true }),
            }),
        )
    })

    it('does not let one failing row abort the rest of the batch', async () => {
        const send = jest
            .fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce([{ status: 'ok', id: 't' }])
        const { service } = build({
            pending: [row({ id: 'n1' }), row({ id: 'n2' })],
            devicesByUser: { u1: ['tokA'] },
            send,
        })

        const delivered = await service.deliverPending()

        expect(delivered).toBe(1)
        expect(send).toHaveBeenCalledTimes(2)
    })

    it('is not jammed by a full batch of deviceless rows ahead of a deliverable one', async () => {
        const deviceless = Array.from({ length: 200 }, (_, i) =>
            row({ id: `d${i}`, userId: `web${i}` }),
        )
        const queue = [...deviceless, row({ id: 'real', userId: 'u1' })]
        const devicesByUser: Record<string, string[]> = { u1: ['tokA'] }
        const send = jest.fn().mockResolvedValue([{ status: 'ok', id: 't1' }])
        const prisma = {
            notification: {
                // Honours the device filter and the batch size like Postgres.
                findMany: jest.fn(
                    ({
                        where,
                        take,
                    }: {
                        where: { user?: { firebaseDevices?: unknown } }
                        take: number
                    }) =>
                        Promise.resolve(
                            queue
                                .filter(
                                    (r) =>
                                        !where.user?.firebaseDevices ||
                                        (devicesByUser[r.userId] ?? []).length >
                                            0,
                                )
                                .slice(0, take),
                        ),
                ),
                update: jest.fn().mockResolvedValue({}),
            },
            firebaseDevice: {
                findMany: jest.fn(({ where }: { where: { userId: string } }) =>
                    Promise.resolve(
                        (devicesByUser[where.userId] ?? []).map((token) => ({
                            token,
                        })),
                    ),
                ),
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        }
        const service = new PushDeliveryService(
            prisma as never,
            { send } as never,
        )

        expect(await service.deliverPending()).toBe(1)
        expect(prisma.notification.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'real' } }),
        )
    })
})
