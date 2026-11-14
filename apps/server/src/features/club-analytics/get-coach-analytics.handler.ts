import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadCoachReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'
import { GetCoachAnalyticsFeature, GetCoachAnalyticsFeatureResponse } from './get-coach-analytics.feature'
import { serializeCoachReport } from './schemas'

// Comparing coaches is the sport leads' view (owner, admin, head coach): a
// coach or a direction manager does not rank their colleagues.
@Feature(GetCoachAnalyticsFeature)
export class GetCoachAnalyticsHandler
    implements IFeatureHandler<GetCoachAnalyticsFeature, GetCoachAnalyticsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetCoachAnalyticsFeature): Promise<GetCoachAnalyticsFeatureResponse> {
        await assertSportLead(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const { scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        return serializeCoachReport(
            await loadCoachReport(this.prisma, { workspaceId: f.workspaceId, scope, now: new Date() }),
        )
    }
}
