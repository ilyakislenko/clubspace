import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadCoachReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'
import { GetCoachAnalyticsFeature, GetCoachAnalyticsFeatureResponse } from './get-coach-analytics.feature'
import { serializeCoachReport } from './schemas'

@Feature(GetCoachAnalyticsFeature)
export class GetCoachAnalyticsHandler
    implements IFeatureHandler<GetCoachAnalyticsFeature, GetCoachAnalyticsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetCoachAnalyticsFeature): Promise<GetCoachAnalyticsFeatureResponse> {
        const { scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        return serializeCoachReport(
            await loadCoachReport(this.prisma, { workspaceId: f.workspaceId, scope, now: new Date() }),
        )
    }
}
