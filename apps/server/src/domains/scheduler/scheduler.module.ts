import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { NotificationProducerModule } from '../notifications/notification-producer.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { RetentionDigestService } from '../retention/retention-digest.service'
import { FirstVisitPendingService } from '../subscriptions/services/first-visit-pending.service'
import { PaymentReminderService } from '../subscriptions/services/payment-reminder.service'
import { DailyClubService } from './daily-club.service'
import { DataPurgeService } from './data-purge.service'
import { RemindersService } from './reminders.service'
import { SCHEDULER_PROCESSORS, SCHEDULER_QUEUES } from './scheduler.processors'

// Home of the time-driven background jobs: one BullMQ queue + repeatable job
// each (see scheduler.processors.ts). A new periodic task gets its own queue
// with a schedule that fits it, rather than riding an existing one.
@Module({
    imports: [
        PrismaModule,
        NotificationProducerModule,
        RealtimeModule,
        ...Object.values(SCHEDULER_QUEUES).map((name) =>
            BullModule.registerQueue({ name }),
        ),
    ],
    providers: [
        RemindersService,
        DailyClubService,
        DataPurgeService,
        FirstVisitPendingService,
        PaymentReminderService,
        RetentionDigestService,
        ...SCHEDULER_PROCESSORS,
    ],
})
export class SchedulerModule {}
