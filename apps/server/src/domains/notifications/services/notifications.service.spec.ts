import { EMAIL_JOB_OPTS } from '../email-queue'
import { NotificationsService } from './notifications.service'

const build = () => {
    const prisma = {
        notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    }
    const emailQueue = { add: jest.fn().mockResolvedValue({ id: 'job1' }) }
    const push = { enqueue: jest.fn().mockResolvedValue(undefined) }
    const service = new NotificationsService(
        prisma as never,
        emailQueue as never,
        push as never,
    )
    return { service, prisma, emailQueue, push }
}

const payload = (type: 'EMAIL' | 'PUSH' | 'TELEGRAM') =>
    ({
        userId: 'u1',
        identity: 'a@b.com',
        type,
        topic: 't',
        message: 'm',
    }) as never

describe('NotificationsService.sendNotification', () => {
    it('writes the row, then queues the e-mail with retries', async () => {
        const { service, prisma, emailQueue, push } = build()

        expect(await service.sendNotification(payload('EMAIL'))).toBe('n1')

        expect(prisma.notification.create.mock.calls[0][0].data).toMatchObject({
            type: 'EMAIL',
            sent: false,
        })
        expect(emailQueue.add).toHaveBeenCalledWith(
            'send',
            { notificationId: 'n1', to: 'a@b.com' },
            EMAIL_JOB_OPTS,
        )
        expect(push.enqueue).not.toHaveBeenCalled()
    })

    it('fails loudly when the e-mail cannot be queued', async () => {
        const { service, emailQueue } = build()
        emailQueue.add.mockRejectedValue(new Error('redis down'))

        await expect(service.sendNotification(payload('EMAIL'))).rejects.toThrow(
            'redis down',
        )
    })

    it('hands a push row to the push queue', async () => {
        const { service, emailQueue, push } = build()

        await service.sendNotification(payload('PUSH'))

        expect(push.enqueue).toHaveBeenCalledWith(['n1'])
        expect(emailQueue.add).not.toHaveBeenCalled()
    })

    it('only writes the inbox row for a channel without a transport', async () => {
        const { service, emailQueue, push } = build()

        expect(await service.sendNotification(payload('TELEGRAM'))).toBe('n1')

        expect(push.enqueue).not.toHaveBeenCalled()
        expect(emailQueue.add).not.toHaveBeenCalled()
    })
})

describe('NotificationsService.updateNotificationStatus', () => {
    const buildForStatus = () => {
        const prisma = {
            notification: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        }
        const service = new NotificationsService(
            prisma as never,
            {} as never,
            {} as never,
        )
        return { service, prisma }
    }

    it('records a successful delivery with a timestamp', async () => {
        const { service, prisma } = buildForStatus()

        await service.updateNotificationStatus({ id: 'n1', sent: true } as never)

        const args = prisma.notification.updateMany.mock.calls[0][0]
        expect(args.where).toEqual({ id: 'n1' })
        expect(args.data.sent).toBe(true)
        expect(args.data.sentAt).toBeInstanceOf(Date)
    })

    it('leaves sentAt null when the send failed', async () => {
        const { service, prisma } = buildForStatus()

        await service.updateNotificationStatus({
            id: 'n1',
            sent: false,
            error: 'connect ECONNREFUSED',
        } as never)

        const args = prisma.notification.updateMany.mock.calls[0][0]
        expect(args.data.sentAt).toBeNull()
        expect(args.data.error).toBe('connect ECONNREFUSED')
    })

    // This runs from the e-mail worker, long after the originating request
    // answered. With `update` a vanished row raised P2025 — deleting a user
    // while their email was in flight failed the job for nothing. updateMany
    // reports zero rows instead.
    it('is a no-op when the notification is already gone', async () => {
        const { service, prisma } = buildForStatus()
        prisma.notification.updateMany.mockResolvedValue({ count: 0 })

        await expect(
            service.updateNotificationStatus({ id: 'gone', sent: true } as never),
        ).resolves.toBeUndefined()
    })
})

describe('NotificationsService.markSeen', () => {
    const make = () => {
        const prisma = {
            notification: {
                updateMany: jest.fn().mockResolvedValue({ count: 3 }),
            },
        }
        const service = new NotificationsService(
            prisma as never,
            {} as never,
            {} as never,
        )
        return { service, prisma }
    }

    it('scopes to the user + unseen rows and returns the count', async () => {
        const { service, prisma } = make()
        expect(await service.markSeen({ userId: 'u1' })).toBe(3)
        expect(prisma.notification.updateMany).toHaveBeenCalledWith({
            where: { userId: 'u1', seen: false },
            data: { seen: true },
        })
    })

    it('filters by ids when provided', async () => {
        const { service, prisma } = make()
        await service.markSeen({ userId: 'u1', ids: ['a', 'b'] })
        expect(prisma.notification.updateMany).toHaveBeenCalledWith({
            where: { userId: 'u1', seen: false, id: { in: ['a', 'b'] } },
            data: { seen: true },
        })
    })
})
