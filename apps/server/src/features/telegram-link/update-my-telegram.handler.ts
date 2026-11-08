import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TelegramBotClient } from '../../domains/telegram/telegram-bot.client'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { TELEGRAM_UNAVAILABLE_MESSAGE } from './create-telegram-link.handler'
import { loadTelegramStatus } from './schemas'
import {
    UpdateMyTelegramFeature,
    UpdateMyTelegramFeatureResponse,
} from './telegram-link.feature'

// The «Telegram» switch: pause or resume the copies without unlinking the chat.
@Feature(UpdateMyTelegramFeature)
export class UpdateMyTelegramHandler
    implements IFeatureHandler<UpdateMyTelegramFeature, UpdateMyTelegramFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
    ) {}

    async execute({ userId, payload }: UpdateMyTelegramFeature) {
        if (!this.bot.available) {
            throw new BadRequestError({ message: TELEGRAM_UNAVAILABLE_MESSAGE })
        }
        const link = await this.prisma.telegramLink.findUnique({
            where: { userId },
            select: { userId: true },
        })
        if (!link) {
            throw new BadRequestError({ message: 'Сначала подключите Telegram' })
        }
        await this.prisma.notificationPreferences.upsert({
            where: { userId },
            create: {
                userId,
                emailEnabled: false,
                pushEnabled: false,
                telegramEnabled: payload.enabled,
            },
            update: { telegramEnabled: payload.enabled },
        })
        return loadTelegramStatus(this.prisma, true, userId)
    }
}
