import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TelegramBotClient } from '../../domains/telegram/telegram-bot.client'
import {
    generateTelegramLinkToken,
    TELEGRAM_LINK_TTL_MS,
    telegramDeepLink,
} from '../../domains/telegram/telegram-utils'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    CreateTelegramLinkFeature,
    CreateTelegramLinkFeatureResponse,
} from './telegram-link.feature'

export const TELEGRAM_UNAVAILABLE_MESSAGE = 'Telegram-уведомления на сервере не настроены'

@Feature(CreateTelegramLinkFeature)
export class CreateTelegramLinkHandler
    implements IFeatureHandler<CreateTelegramLinkFeature, CreateTelegramLinkFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
    ) {}

    // A fresh one-time token per press; the previous ones stop working, so only
    // the link the person just opened can complete.
    async execute({ userId }: CreateTelegramLinkFeature) {
        const botUsername = this.bot.botUsername
        if (!this.bot.available || !botUsername) {
            throw new BadRequestError({ message: TELEGRAM_UNAVAILABLE_MESSAGE })
        }
        const { token, hash } = generateTelegramLinkToken()
        const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_MS)
        await this.prisma.$transaction([
            this.prisma.telegramLinkToken.deleteMany({ where: { userId } }),
            this.prisma.telegramLinkToken.create({
                data: { userId, tokenHash: hash, expiresAt },
            }),
        ])
        return {
            url: telegramDeepLink(botUsername, token),
            expiresAt: expiresAt.toISOString(),
        }
    }
}
