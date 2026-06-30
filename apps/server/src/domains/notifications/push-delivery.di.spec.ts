import { Test } from '@nestjs/testing'

import { PrismaService } from '../../infrastructure/prisma'
import { ExpoPushClient } from './services/expo-push.client'
import { PushDeliveryService } from './services/push-delivery.service'

// Guards the DI wiring used by PushDeliveryModule (and, transitively, by the
// scheduler tick that injects PushDeliveryService). A primitive constructor
// param or a missing token would fail to compile here even though the plain
// unit tests — which `new` the services directly — would still pass.
describe('PushDelivery dependency injection', () => {
    it('resolves PushDeliveryService and ExpoPushClient', async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                ExpoPushClient,
                PushDeliveryService,
                { provide: PrismaService, useValue: {} },
            ],
        }).compile()

        expect(moduleRef.get(ExpoPushClient)).toBeInstanceOf(ExpoPushClient)
        expect(moduleRef.get(PushDeliveryService)).toBeInstanceOf(
            PushDeliveryService,
        )
    })
})
