import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { TelegramBotClient } from './telegram-bot.client'
import { TelegramDeliveryProcessor } from './telegram-delivery.processor'
import { TelegramDeliveryService } from './telegram-delivery.service'
import { TELEGRAM_QUEUE } from './telegram-queue'
import { TelegramQueueService } from './telegram-queue.service'

// The member-facing Telegram bot: the Bot API client (linking replies), the
// `telegram` queue's producer and its worker. Dependency-light like
// PushDeliveryModule, which imports it to mirror the rows it delivers.
@Module({
    imports: [PrismaModule, BullModule.registerQueue({ name: TELEGRAM_QUEUE })],
    providers: [
        TelegramBotClient,
        TelegramQueueService,
        TelegramDeliveryService,
        TelegramDeliveryProcessor,
    ],
    exports: [TelegramBotClient, TelegramQueueService],
})
export class TelegramModule {}
