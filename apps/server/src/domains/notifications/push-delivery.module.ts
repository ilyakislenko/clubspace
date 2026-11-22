import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { TelegramModule } from '../telegram/telegram.module'
import { PUSH_QUEUE } from './push-queue'
import { ExpoPushClient } from './services/expo-push.client'
import { PushDeliveryProcessor } from './services/push-delivery.processor'
import { PushDeliveryService } from './services/push-delivery.service'
import { PushQueueService } from './services/push-queue.service'
import { WebPushClient } from './services/web-push.client'

// The `push` queue (Expo devices and browser Web Push): producer (PushQueueService, used by every writer of PUSH
// notification rows) and its workers. Standalone and dependency-light so the
// notification producer, NotificationsModule and the scheduler can all import
// it without pulling in each other. Rows it claims are mirrored to Telegram
// (TelegramModule's own queue).
@Module({
    imports: [
        PrismaModule,
        TelegramModule,
        BullModule.registerQueue({ name: PUSH_QUEUE }),
    ],
    providers: [
        ExpoPushClient,
        PushDeliveryService,
        PushQueueService,
        PushDeliveryProcessor,
        WebPushClient,
    ],
    exports: [PushQueueService, WebPushClient],
})
export class PushDeliveryModule {}
