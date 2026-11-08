import { TELEGRAM_SEND_JOB_OPTS } from './telegram-queue'
import { TelegramQueueService } from './telegram-queue.service'

const build = (o: { linked?: string[]; available?: boolean; addBulk?: jest.Mock } = {}) => {
    const prisma = {
        telegramLink: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.linked ?? []).map((userId) => ({ userId }))),
        },
    }
    const bot = { available: o.available ?? true }
    const queue = { addBulk: o.addBulk ?? jest.fn().mockResolvedValue([]) }
    const service = new TelegramQueueService(prisma as never, bot as never, queue as never)
    return { service, prisma, queue }
}

describe('TelegramQueueService', () => {
    it('queues only the rows of users with a linked chat and Telegram on', async () => {
        const { service, prisma, queue } = build({ linked: ['u2'] })
        await service.enqueueForLinkedUsers([
            { id: 'n1', userId: 'u1' },
            { id: 'n2', userId: 'u2' },
            { id: 'n3', userId: 'u2' },
        ])
        expect(prisma.telegramLink.findMany.mock.calls[0][0].where).toEqual({
            userId: { in: ['u1', 'u2'] },
            user: { notificationPreferences: { is: { telegramEnabled: true } } },
        })
        expect(queue.addBulk).toHaveBeenCalledWith([
            {
                name: 'send',
                data: { notificationId: 'n2' },
                opts: { ...TELEGRAM_SEND_JOB_OPTS, jobId: 'tg-n2' },
            },
            {
                name: 'send',
                data: { notificationId: 'n3' },
                opts: { ...TELEGRAM_SEND_JOB_OPTS, jobId: 'tg-n3' },
            },
        ])
    })

    it('queues nothing when nobody is linked', async () => {
        const { service, queue } = build({ linked: [] })
        await service.enqueueForLinkedUsers([{ id: 'n1', userId: 'u1' }])
        expect(queue.addBulk).not.toHaveBeenCalled()
    })

    it('touches neither database nor queue with the bot switched off', async () => {
        const { service, prisma, queue } = build({ available: false, linked: ['u1'] })
        await service.enqueueForLinkedUsers([{ id: 'n1', userId: 'u1' }])
        await service.enqueue(['n1'])
        expect(prisma.telegramLink.findMany).not.toHaveBeenCalled()
        expect(queue.addBulk).not.toHaveBeenCalled()
    })

    it('never throws when Redis is down', async () => {
        const { service } = build({
            linked: ['u1'],
            addBulk: jest.fn().mockRejectedValue(new Error('redis down')),
        })
        await expect(
            service.enqueueForLinkedUsers([{ id: 'n1', userId: 'u1' }]),
        ).resolves.toBeUndefined()
        await expect(service.enqueue(['n1'])).resolves.toBeUndefined()
    })
})
