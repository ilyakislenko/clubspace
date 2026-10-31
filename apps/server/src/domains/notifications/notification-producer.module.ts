import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { RealtimeModule } from '../realtime/realtime.module'
import { PushDeliveryModule } from './push-delivery.module'
import { NotificationProducerService } from './services/notification-producer.service'

// Provides the event-driven notification producer to every module that emits
// notifications — AppModule's feature handlers and (crucially) VideoModule's
// VideoService, which lives in its own encapsulated context and can't reach an
// ad-hoc AppModule provider. Kept separate from the dynamic NotificationsModule
// (email/prefs/devices) since the producer only needs Prisma, RealtimeEmitter
// and the push queue.
@Module({
    imports: [PrismaModule, RealtimeModule, PushDeliveryModule],
    providers: [NotificationProducerService],
    exports: [NotificationProducerService],
})
export class NotificationProducerModule {}
