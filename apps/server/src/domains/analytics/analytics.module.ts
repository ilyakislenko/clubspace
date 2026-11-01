import { Module } from '@nestjs/common'

import { PrismaModule } from '../../infrastructure/prisma'
import { NotificationProducerModule } from '../notifications/notification-producer.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { AnalyticsDigestService } from './analytics-digest.service'
import { AnalyticsSnapshotService } from './analytics-snapshot.service'

// «Аналитика» (docs/design/2026-11-01-smart-analytics.md): the snapshot
// builder and the weekly owner digest, shared by the scheduler, the analytics
// handlers and the demo reset.
@Module({
    imports: [PrismaModule, NotificationProducerModule, NotificationsModule],
    providers: [AnalyticsSnapshotService, AnalyticsDigestService],
    exports: [AnalyticsSnapshotService, AnalyticsDigestService],
})
export class AnalyticsModule {}
