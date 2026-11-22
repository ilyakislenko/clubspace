import { InjectQueue } from '@nestjs/bullmq'
import { Feature, IFeatureHandler } from '@shelfjs/features'
import type { Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RefreshAnalyticsFeature,
    RefreshAnalyticsFeatureResponse,
} from './refresh-analytics.feature'
import {
    ANALYTICS_FRESH_MS,
    ANALYTICS_REFRESH_QUEUE,
    queueAnalyticsRefresh,
} from './refresh-analytics.processor'

// Answers at once: snapshots a few minutes old are kept as they are, anything
// older gets a background rebuild (one per club at a time).
@Feature(RefreshAnalyticsFeature)
export class RefreshAnalyticsHandler
    implements IFeatureHandler<RefreshAnalyticsFeature, RefreshAnalyticsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        @InjectQueue(ANALYTICS_REFRESH_QUEUE) private readonly queue: Queue,
    ) {}

    async execute(f: RefreshAnalyticsFeature): Promise<RefreshAnalyticsFeatureResponse> {
        await assertSportLead(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const run = await this.prisma.analyticsRun.findUnique({
            where: { workspaceId: f.workspaceId },
            select: { historyComputedAt: true, riskComputedAt: true },
        })
        const freshFrom = Date.now() - ANALYTICS_FRESH_MS
        const fresh =
            !!run?.historyComputedAt &&
            !!run.riskComputedAt &&
            run.historyComputedAt.getTime() > freshFrom &&
            run.riskComputedAt.getTime() > freshFrom
        if (!fresh) await queueAnalyticsRefresh(this.queue, f.workspaceId)
        return {
            status: fresh ? 'fresh' : 'queued',
            historyComputedAt: run?.historyComputedAt?.toISOString() ?? null,
            riskComputedAt: run?.riskComputedAt?.toISOString() ?? null,
        }
    }
}
