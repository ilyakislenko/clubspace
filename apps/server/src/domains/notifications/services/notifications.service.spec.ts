import { Logger } from '@nestjs/common'

import { NotificationsService } from './notifications.service'

const build = (sendImpl: () => Promise<void>) => {
    const prisma = {
        notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    }
    const events = { send: jest.fn().mockImplementation(sendImpl) }
    const service = new NotificationsService(prisma as never, events as never)
    return { service, prisma, events }
}

const payload = {
    userId: 'u1',
    identity: 'a@b.com',
    type: 'EMAIL',
    topic: 't',
    message: 'm',
} as never

describe('NotificationsService.sendNotification', () => {
    it('returns the id and swallows a publish failure (no unhandled rejection)', async () => {
        const warn = jest
            .spyOn(Logger.prototype, 'warn')
            .mockImplementation(() => undefined)
        const { service, events } = build(() =>
            Promise.reject(new Error('bus down')),
        )

        const id = await service.sendNotification(payload)

        expect(id).toBe('n1')
        expect(events.send).toHaveBeenCalledTimes(1)
        // let the .catch microtask run, then confirm the failure was logged
        await Promise.resolve()
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    it('returns the id on a successful publish', async () => {
        const { service } = build(() => Promise.resolve())
        expect(await service.sendNotification(payload)).toBe('n1')
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
