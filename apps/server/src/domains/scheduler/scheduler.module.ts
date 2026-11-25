import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { AnalyticsModule } from '../analytics/analytics.module'
import { NotificationProducerModule } from '../notifications/notification-producer.module'
import { MessagesModule } from '../messages/messages.module'
import { RealtimeModule } from '../realtime/realtime.module'
import { RetentionDigestService } from '../retention/retention-digest.service'
import { FirstVisitPendingService } from '../subscriptions/services/first-visit-pending.service'
import { PaymentReminderService } from '../subscriptions/services/payment-reminder.service'
import { DailyClubService } from './daily-club.service'
import { DataPurgeService } from './data-purge.service'
import { PlaylistModule } from '../playlist/playlist.module'
import { RemindersService } from './reminders.service'
import { ReviewRemindersService } from './review-reminders.service'
import { ClassBookingService } from '../class-bookings/class-booking.service'
import { SCHEDULER_PROCESSORS, SCHEDULER_QUEUES } from './scheduler.processors'

// Home of the time-driven background jobs: one BullMQ queue + repeatable job
// each (see scheduler.processors.ts). A new periodic task gets its own queue
// with a schedule that fits it, rather than riding an existing one.
@Module({
    imports: [
        PrismaModule,
        NotificationProducerModule,
        RealtimeModule,
        AnalyticsModule,
        // CourseAccessService: review reminders count only cards still watchable.
        PlaylistModule,
        // ClubMessageDeliveryService: due club messages go out from the minute job.
        MessagesModule,
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
        ClassBookingService,
        ReviewRemindersService,
        ...SCHEDULER_PROCESSORS,
    ],
})
export class SchedulerModule {}
