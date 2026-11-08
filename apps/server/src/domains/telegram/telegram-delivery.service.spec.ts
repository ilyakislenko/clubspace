import { TelegramDeliveryService, TelegramTransientError } from './telegram-delivery.service'

const NOW = new Date('2026-11-08T12:00:00Z')

const notification = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    userId: 'u1',
    type: 'PUSH',
    topic: 'Объявление',
    message: 'Завтра тренировки не будет',
    link: null,
    metadata: { kind: 'announcement.created', workspaceId: 'w1' },
    createdAt: new Date(NOW.getTime() - 60_000),
    ...over,
})

const build = (o: {
    row?: ReturnType<typeof notification> | null
    link?: { chatId: string; telegramEnabled: boolean | null } | null
    muted?: boolean
    send?: jest.Mock
    available?: boolean
}) => {
    const prisma = {
        notification: {
            findUnique: jest.fn().mockResolvedValue(o.row === undefined ? notification() : o.row),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        telegramLink: {
            findUnique: jest.fn().mockResolvedValue(
                o.link === null
                    ? null
                    : {
                          chatId: o.link?.chatId ?? '777',
                          user: {
                              notificationPreferences:
                                  o.link?.telegramEnabled === null
                                      ? null
                                      : { telegramEnabled: o.link?.telegramEnabled ?? true },
                          },
                      },
            ),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ notificationsMuted: o.muted === true }),
        },
    }
    const bot = {
        available: o.available ?? true,
        sendMessage: o.send ?? jest.fn().mockResolvedValue({ status: 'ok' }),
    }
    const service = new TelegramDeliveryService(prisma as never, bot as never)
    return { service, prisma, bot }
}

describe('TelegramDeliveryService.deliver', () => {
    it('sends title and body to the linked chat when Telegram is on', async () => {
        const { service, bot, prisma } = build({})
        expect(await service.deliver('n1', NOW)).toBe('sent')
        const [chatId, text] = bot.sendMessage.mock.calls[0]
        expect(chatId).toBe('777')
        expect(text).toContain('Объявление\n\nЗавтра тренировки не будет')
        // A PUSH row's sent flag belongs to push delivery.
        expect(prisma.notification.updateMany).not.toHaveBeenCalled()
    })

    it('sends nothing to a user without a linked chat', async () => {
        const { service, bot } = build({ link: null })
        expect(await service.deliver('n1', NOW)).toBe('skipped')
        expect(bot.sendMessage).not.toHaveBeenCalled()
    })

    it.each([false, null])(
        'sends nothing while Telegram is switched off (telegramEnabled %p)',
        async (telegramEnabled) => {
            const { service, bot } = build({ link: { chatId: '777', telegramEnabled } })
            expect(await service.deliver('n1', NOW)).toBe('skipped')
            expect(bot.sendMessage).not.toHaveBeenCalled()
        },
    )

    it('sends nothing for a club the member muted', async () => {
        const { service, bot, prisma } = build({ muted: true })
        expect(await service.deliver('n1', NOW)).toBe('skipped')
        expect(bot.sendMessage).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.findUnique.mock.calls[0][0].where).toEqual({
            userId_workspaceId: { userId: 'u1', workspaceId: 'w1' },
        })
    })

    it('still sends a mute-exempt kind from a muted club', async () => {
        const { service, bot } = build({
            muted: true,
            row: notification({ metadata: { kind: 'subscription.expiring', workspaceId: 'w1' } }),
        })
        expect(await service.deliver('n1', NOW)).toBe('sent')
        expect(bot.sendMessage).toHaveBeenCalled()
    })

    it('unlinks the chat when Telegram answers 403 (bot blocked)', async () => {
        const { service, prisma } = build({
            send: jest.fn().mockResolvedValue({ status: 'blocked', message: 'telegram 403' }),
        })
        expect(await service.deliver('n1', NOW)).toBe('unlinked')
        expect(prisma.telegramLink.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', chatId: '777' },
        })
    })

    it('throws on a transient failure so the queue retries', async () => {
        const { service, prisma } = build({
            send: jest.fn().mockResolvedValue({ status: 'transient', message: 'telegram 429' }),
        })
        await expect(service.deliver('n1', NOW)).rejects.toBeInstanceOf(TelegramTransientError)
        expect(prisma.telegramLink.deleteMany).not.toHaveBeenCalled()
    })

    it('records the outcome on its own TELEGRAM row', async () => {
        const { service, prisma } = build({ row: notification({ type: 'TELEGRAM' }) })
        expect(await service.deliver('n1', NOW)).toBe('sent')
        expect(prisma.notification.updateMany).toHaveBeenCalledWith({
            where: { id: 'n1' },
            data: { sent: true, error: null, sentAt: NOW },
        })
    })

    it('skips e-mail rows, rows past the age window and a switched-off bot', async () => {
        for (const o of [
            { row: notification({ type: 'EMAIL' }) },
            { row: notification({ createdAt: new Date(NOW.getTime() - 4 * 86_400_000) }) },
            { row: null },
            { available: false },
        ]) {
            const { service, bot } = build(o)
            expect(await service.deliver('n1', NOW)).toBe('skipped')
            expect(bot.sendMessage).not.toHaveBeenCalled()
        }
    })
})
