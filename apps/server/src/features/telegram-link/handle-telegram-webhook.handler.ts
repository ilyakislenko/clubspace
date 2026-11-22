import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TelegramBotClient } from '../../domains/telegram/telegram-bot.client'
import {
    hashTelegramLinkToken,
    looksLikeTelegramLinkToken,
    parseTelegramCommand,
    telegramSecretMatches,
} from '../../domains/telegram/telegram-utils'
import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import {
    HandleTelegramWebhookFeature,
    HandleTelegramWebhookFeatureResponse,
    TelegramUpdateSchema,
} from './telegram-link.feature'

export const TELEGRAM_REPLIES = {
    linked: 'Готово, уведомления будут приходить сюда.',
    expired:
        'Ссылка устарела. Откройте настройки уведомлений в приложении и нажмите «Подключить» ещё раз.',
    unknown:
        'Ссылка недействительна. Откройте настройки уведомлений в приложении и нажмите «Подключить».',
    hint: 'Чтобы получать сюда уведомления клуба, откройте настройки уведомлений в приложении и нажмите «Подключить».',
    stopped: 'Уведомления отключены. Подключить снова можно в настройках уведомлений в приложении.',
} as const

const OK = { ok: true as const }

// Updates from Telegram (setWebhook with secret_token, deploy/README.md). Public,
// authenticated by the secret header only; the body is otherwise untrusted and
// read for one thing: a text command in a private chat. Always 200 once
// authenticated, or Telegram re-delivers the update.
@Feature(HandleTelegramWebhookFeature)
export class HandleTelegramWebhookHandler
    implements
        IFeatureHandler<HandleTelegramWebhookFeature, HandleTelegramWebhookFeatureResponse>
{
    private readonly logger = new Logger(HandleTelegramWebhookHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
    ) {}

    async execute({ secretToken, update }: HandleTelegramWebhookFeature) {
        const secret = this.bot.webhookSecret
        if (!this.bot.available || !secret) {
            throw new NotFoundError({ message: 'Telegram-бот не настроен' })
        }
        if (!telegramSecretMatches(secret, secretToken)) {
            throw new ForbiddenError()
        }
        const parsed = TelegramUpdateSchema.safeParse(update)
        const message = parsed.success ? parsed.data.message : undefined
        if (!message?.text || message.chat.type !== 'private') return OK
        const command = parseTelegramCommand(message.text)
        if (!command) return OK
        const chatId = String(message.chat.id)

        if (command.command === 'stop') {
            await this.prisma.telegramLink.deleteMany({ where: { chatId } })
            await this.reply(chatId, TELEGRAM_REPLIES.stopped)
            return OK
        }
        if (!command.arg) {
            await this.reply(chatId, TELEGRAM_REPLIES.hint)
            return OK
        }
        await this.reply(chatId, await this.link(chatId, command.arg))
        return OK
    }

    // `/start <token>`: the one-time token from the app binds this chat to its
    // account. Returns the reply.
    private async link(chatId: string, token: string): Promise<string> {
        if (!looksLikeTelegramLinkToken(token)) return TELEGRAM_REPLIES.unknown
        const now = new Date()
        const row = await this.prisma.telegramLinkToken.findUnique({
            where: { tokenHash: hashTelegramLinkToken(token) },
            select: { id: true, userId: true, expiresAt: true, usedAt: true },
        })
        if (!row) return TELEGRAM_REPLIES.unknown
        if (row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
            return TELEGRAM_REPLIES.expired
        }
        // Claimed atomically: two deliveries of the same update (Telegram
        // retries) or a forwarded link link the chat once.
        const claimed = await this.prisma.telegramLinkToken.updateMany({
            where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
            data: { usedAt: now },
        })
        if (claimed.count === 0) return TELEGRAM_REPLIES.expired
        const userId = row.userId
        await this.prisma.$transaction([
            // One chat per account, one account per chat: a chat that served
            // another account moves to this one.
            this.prisma.telegramLink.deleteMany({
                where: { OR: [{ chatId }, { userId }] },
            }),
            this.prisma.telegramLink.create({ data: { userId, chatId, linkedAt: now } }),
            // Linking is the opt-in.
            this.prisma.notificationPreferences.upsert({
                where: { userId },
                create: {
                    userId,
                    emailEnabled: false,
                    pushEnabled: false,
                    telegramEnabled: true,
                },
                update: { telegramEnabled: true },
            }),
        ])
        return TELEGRAM_REPLIES.linked
    }

    // Best effort: the link is stored either way.
    private async reply(chatId: string, text: string): Promise<void> {
        const res = await this.bot.sendMessage(chatId, text)
        if (res.status !== 'ok') {
            this.logger.warn(`telegram reply not sent: ${res.message}`)
        }
    }
}
