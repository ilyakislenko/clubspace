import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AnalyticsSnapshotService } from '../../domains/analytics/analytics-snapshot.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RefreshAnalyticsFeature,
    RefreshAnalyticsFeatureResponse,
} from './refresh-analytics.feature'

@Feature(RefreshAnalyticsFeature)
export class RefreshAnalyticsHandler
    implements IFeatureHandler<RefreshAnalyticsFeature, RefreshAnalyticsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly snapshots: AnalyticsSnapshotService,
    ) {}

    async execute(f: RefreshAnalyticsFeature): Promise<RefreshAnalyticsFeatureResponse> {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.snapshots.refresh(f.workspaceId)
        const run = await this.prisma.analyticsRun.findUnique({
            where: { workspaceId: f.workspaceId },
        })
        return {
            historyComputedAt: run?.historyComputedAt?.toISOString() ?? null,
            riskComputedAt: run?.riskComputedAt?.toISOString() ?? null,
        }
    }
}
