import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'

import { PrismaService } from '../../infrastructure/prisma'
import { TelegramBotClient } from './telegram-bot.client'
import { TelegramDeliveryProcessor } from './telegram-delivery.processor'
import { TelegramDeliveryService } from './telegram-delivery.service'
import { TELEGRAM_QUEUE } from './telegram-queue'
import { TelegramQueueService } from './telegram-queue.service'

// Guards TelegramModule's DI wiring (the bot client's optional config token
// must not turn into an unresolvable dependency).
describe('Telegram dependency injection', () => {
    it('resolves the bot client, producer, delivery service and worker', async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                TelegramBotClient,
                TelegramQueueService,
                TelegramDeliveryService,
                TelegramDeliveryProcessor,
                { provide: PrismaService, useValue: {} },
                { provide: getQueueToken(TELEGRAM_QUEUE), useValue: {} },
            ],
        }).compile()

        expect(moduleRef.get(TelegramBotClient)).toBeInstanceOf(TelegramBotClient)
        expect(moduleRef.get(TelegramQueueService)).toBeInstanceOf(TelegramQueueService)
        expect(moduleRef.get(TelegramDeliveryService)).toBeInstanceOf(TelegramDeliveryService)
        expect(moduleRef.get(TelegramDeliveryProcessor)).toBeInstanceOf(
            TelegramDeliveryProcessor,
        )
    })
})
