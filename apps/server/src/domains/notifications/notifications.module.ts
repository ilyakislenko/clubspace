import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { EMAIL_QUEUE } from './email-queue'
import { PushDeliveryModule } from './push-delivery.module'
import { NotificationsService } from './services/notifications.service'
import { NotificationsPreferencesService } from './services/preferences.service'

// Inbox, preferences and the per-channel delivery queues (e-mail here, push via
// PushDeliveryModule). The e-mail worker sits in AppModule next to the mail
// health tracker it reports to.
@Module({
    imports: [
        BullModule.registerQueue({ name: EMAIL_QUEUE }),
        PushDeliveryModule,
    ],
    providers: [NotificationsService, NotificationsPreferencesService],
    // PushDeliveryModule re-exported for WebPushClient (the subscribe routes).
    exports: [
        NotificationsService,
        NotificationsPreferencesService,
        PushDeliveryModule,
    ],
})
export class NotificationsModule {}
