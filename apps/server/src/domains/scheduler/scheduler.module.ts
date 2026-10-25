import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { NotificationProducerModule } from '../notifications/notification-producer.module'
import { PushDeliveryModule } from '../notifications/push-delivery.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { FirstVisitPendingService } from '../subscriptions/services/first-visit-pending.service'
import { PaymentReminderService } from '../subscriptions/services/payment-reminder.service'
import { SCHEDULER_TICK_QUEUE, SchedulerTickProcessor } from './scheduler-tick.processor'
import { SchedulerTickService } from './scheduler-tick.service'

// Centralised home for repeatable BullMQ jobs. Today: a single
// 1-minute tick that fans out session reminders, event reminders and
// cancellation notices. Anything else schedule-shaped should hang off
// the same tick rather than spawning more crons — the bottleneck is
// Postgres scans, not the timer itself.
@Module({
    imports: [
        PrismaModule,
        PushDeliveryModule,
        NotificationProducerModule,
        RealtimeModule,
        BullModule.registerQueue({ name: SCHEDULER_TICK_QUEUE }),
    ],
    providers: [
        SchedulerTickService,
        SchedulerTickProcessor,
        FirstVisitPendingService,
        PaymentReminderService,
    ],
    exports: [SchedulerTickService],
})
export class SchedulerModule {}
