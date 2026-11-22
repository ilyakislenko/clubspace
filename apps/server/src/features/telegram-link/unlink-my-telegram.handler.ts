import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TelegramBotClient } from '../../domains/telegram/telegram-bot.client'
import { PrismaService } from '../../infrastructure/prisma'
import { loadTelegramStatus } from './schemas'
import {
    UnlinkMyTelegramFeature,
    UnlinkMyTelegramFeatureResponse,
} from './telegram-link.feature'

// «Отключить»: forget the chat (and any pending link token). Idempotent, and
// allowed with the bot switched off so a chat id can always be dropped.
@Feature(UnlinkMyTelegramFeature)
export class UnlinkMyTelegramHandler
    implements IFeatureHandler<UnlinkMyTelegramFeature, UnlinkMyTelegramFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
    ) {}

    async execute({ userId }: UnlinkMyTelegramFeature) {
        await this.prisma.$transaction([
            this.prisma.telegramLink.deleteMany({ where: { userId } }),
            this.prisma.telegramLinkToken.deleteMany({ where: { userId } }),
        ])
        return loadTelegramStatus(this.prisma, this.bot.available, userId)
    }
}
