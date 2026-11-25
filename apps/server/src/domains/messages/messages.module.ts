import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { BillingModule } from '../billing/billing.module'
import { EmailTemplatesModule } from '../email-templates/email-templates.module'
import { NotificationProducerModule } from '../notifications/notification-producer.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { CallListCacheService } from '../retention/call-list-cache.service'
import { ClubMessageDeliveryService } from './deliver'

// Club messages delivery, shared by the send handler (AppModule) and the
// minute dispatcher (SchedulerModule).
@Module({
    imports: [
        PrismaModule,
        NotificationProducerModule,
        NotificationsModule,
        BillingModule,
        EmailTemplatesModule.forRoot({}),
        RealtimeModule,
    ],
    // The call-list cache (Redis-backed, stateless here): an auto-cancelled
    // message takes back its «Связались».
    providers: [ClubMessageDeliveryService, CallListCacheService],
    exports: [ClubMessageDeliveryService],
})
export class MessagesModule {}
