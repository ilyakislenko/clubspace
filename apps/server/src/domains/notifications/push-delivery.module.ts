import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { ExpoPushClient } from './services/expo-push.client'
import { PushDeliveryService } from './services/push-delivery.service'

// Standalone from NotificationsModule.forRoot: push delivery only needs Prisma
// + the Expo HTTP client, not the events publisher. Keeping it dependency-light
// lets the scheduler module import it directly to flush pending pushes at the
// end of each tick (NotificationsService can't be injected there — it needs the
// events provider wired into an injector tree the scheduler doesn't own).
@Module({
    imports: [PrismaModule],
    providers: [ExpoPushClient, PushDeliveryService],
    exports: [PushDeliveryService],
})
export class PushDeliveryModule {}
