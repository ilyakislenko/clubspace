import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { PUSH_QUEUE } from './push-queue'
import { ExpoPushClient } from './services/expo-push.client'
import { PushDeliveryProcessor } from './services/push-delivery.processor'
import { PushDeliveryService } from './services/push-delivery.service'
import { PushQueueService } from './services/push-queue.service'

// The `push` queue: producer (PushQueueService, used by every writer of PUSH
// notification rows) and its workers. Standalone and dependency-light so the
// notification producer, NotificationsModule and the scheduler can all import
// it without pulling in each other.
@Module({
    imports: [PrismaModule, BullModule.registerQueue({ name: PUSH_QUEUE })],
    providers: [
        ExpoPushClient,
        PushDeliveryService,
        PushQueueService,
        PushDeliveryProcessor,
    ],
    exports: [PushQueueService],
})
export class PushDeliveryModule {}
