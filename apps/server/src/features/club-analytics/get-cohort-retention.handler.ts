import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadCohortReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'
import { GetCohortRetentionFeature, GetCohortRetentionFeatureResponse } from './get-cohort-retention.feature'
import { serializeCohortReport } from './schemas'

@Feature(GetCohortRetentionFeature)
export class GetCohortRetentionHandler
    implements IFeatureHandler<GetCohortRetentionFeature, GetCohortRetentionFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetCohortRetentionFeature): Promise<GetCohortRetentionFeatureResponse> {
        const { scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        return serializeCohortReport(
            await loadCohortReport(this.prisma, { workspaceId: f.workspaceId, scope, now: new Date() }),
        )
    }
}
