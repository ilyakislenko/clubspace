import { getQueueToken } from '@nestjs/bullmq'
import { Test } from '@nestjs/testing'

import { PrismaService } from '../../infrastructure/prisma'
import { PUSH_QUEUE } from './push-queue'
import { ExpoPushClient } from './services/expo-push.client'
import { PushDeliveryProcessor } from './services/push-delivery.processor'
import { PushDeliveryService } from './services/push-delivery.service'
import { PushQueueService } from './services/push-queue.service'

// Guards the DI wiring used by PushDeliveryModule. A primitive constructor
// param or a missing token would fail to compile here even though the plain
// unit tests — which `new` the services directly — would still pass.
describe('PushDelivery dependency injection', () => {
    it('resolves the push producer, delivery service and worker', async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                ExpoPushClient,
                PushDeliveryService,
                PushQueueService,
                PushDeliveryProcessor,
                { provide: PrismaService, useValue: {} },
                { provide: getQueueToken(PUSH_QUEUE), useValue: {} },
            ],
        }).compile()

        expect(moduleRef.get(ExpoPushClient)).toBeInstanceOf(ExpoPushClient)
        expect(moduleRef.get(PushDeliveryService)).toBeInstanceOf(
            PushDeliveryService,
        )
        expect(moduleRef.get(PushQueueService)).toBeInstanceOf(PushQueueService)
        expect(moduleRef.get(PushDeliveryProcessor)).toBeInstanceOf(
            PushDeliveryProcessor,
        )
    })
})
