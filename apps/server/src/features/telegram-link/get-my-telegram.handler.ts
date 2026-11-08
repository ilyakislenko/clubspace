import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TelegramBotClient } from '../../domains/telegram/telegram-bot.client'
import { PrismaService } from '../../infrastructure/prisma'
import { loadTelegramStatus } from './schemas'
import {
    GetMyTelegramFeature,
    GetMyTelegramFeatureResponse,
} from './telegram-link.feature'

@Feature(GetMyTelegramFeature)
export class GetMyTelegramHandler
    implements IFeatureHandler<GetMyTelegramFeature, GetMyTelegramFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
    ) {}

    async execute({ userId }: GetMyTelegramFeature) {
        return loadTelegramStatus(this.prisma, this.bot.available, userId)
    }
}
