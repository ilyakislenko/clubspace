import { Injectable } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { isMutedFor } from '../notifications/notification-mute'
import { TelegramBotClient } from './telegram-bot.client'
import { formatTelegramText } from './telegram-utils'

// Same window as push: after downtime, don't fire a reminder for a session
// that already happened.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

export type TelegramDeliveryOutcome =
    | 'sent'
    // Not linked, Telegram switched off, muted club, too old, gone.
    | 'skipped'
    // Telegram answered 403 (bot blocked): the chat was unlinked.
    | 'unlinked'
    // A permanent refusal for this message; logged on a TELEGRAM row.
    | 'failed'

// Thrown for a 429 / 5xx / timeout so BullMQ retries the job with backoff.
export class TelegramTransientError extends Error {}

@Injectable()
export class TelegramDeliveryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
    ) {}

    /**
     * Sends one notification row to its recipient's Telegram chat. The gates
     * are re-read at send time (the job may have waited): a linked chat,
     * Telegram switched on, and the club not muted for a non-critical kind.
     * A PUSH row's sent flag belongs to push delivery and is left alone; a
     * TELEGRAM row records its own outcome.
     */
    async deliver(
        notificationId: string,
        now: Date = new Date(),
    ): Promise<TelegramDeliveryOutcome> {
        if (!this.bot.available) return 'skipped'
        const row = await this.prisma.notification.findUnique({
            where: { id: notificationId },
            select: {
                id: true,
                userId: true,
                type: true,
                topic: true,
                message: true,
                link: true,
                metadata: true,
                createdAt: true,
            },
        })
        if (
            !row ||
            row.type === NotificationTypeEnum.EMAIL ||
            row.createdAt.getTime() < now.getTime() - MAX_AGE_MS
        ) {
            return 'skipped'
        }
        const own = row.type === NotificationTypeEnum.TELEGRAM
        const record = async (data: { sent: boolean; error: string | null }) => {
            if (!own) return
            await this.prisma.notification.updateMany({
                where: { id: row.id },
                data: { ...data, sentAt: data.sent ? now : null },
            })
        }

        const link = await this.prisma.telegramLink.findUnique({
            where: { userId: row.userId },
            select: {
                chatId: true,
                user: {
                    select: { notificationPreferences: { select: { telegramEnabled: true } } },
                },
            },
        })
        if (!link || link.user.notificationPreferences?.telegramEnabled !== true) {
            await record({ sent: false, error: 'telegram not linked' })
            return 'skipped'
        }
        const meta =
            typeof row.metadata === 'object' && row.metadata !== null
                ? (row.metadata as Record<string, unknown>)
                : {}
        if (
            await isMutedFor(this.prisma, {
                userId: row.userId,
                workspaceId: meta.workspaceId,
                kind: typeof meta.kind === 'string' ? meta.kind : '',
            })
        ) {
            return 'skipped'
        }

        const res = await this.bot.sendMessage(
            link.chatId,
            formatTelegramText(row, environment.appUrl),
        )
        switch (res.status) {
            case 'ok':
                await record({ sent: true, error: null })
                return 'sent'
            case 'blocked':
                // Only this chat: the user may have linked another one since.
                await this.prisma.telegramLink.deleteMany({
                    where: { userId: row.userId, chatId: link.chatId },
                })
                await record({ sent: false, error: res.message })
                return 'unlinked'
            case 'transient':
                throw new TelegramTransientError(res.message)
            case 'error':
                await record({ sent: false, error: res.message })
                return 'failed'
        }
    }
}
