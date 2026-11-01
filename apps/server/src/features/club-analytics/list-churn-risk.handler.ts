import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadChurnReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'
import { ListChurnRiskFeature, ListChurnRiskFeatureResponse } from './list-churn-risk.feature'
import { serializeChurnRiskMember } from './schemas'

@Feature(ListChurnRiskFeature)
export class ListChurnRiskHandler
    implements IFeatureHandler<ListChurnRiskFeature, ListChurnRiskFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListChurnRiskFeature): Promise<ListChurnRiskFeatureResponse> {
        const { isAdmin, scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        const report = await loadChurnReport(this.prisma, {
            workspaceId: f.workspaceId,
            scope,
            now: new Date(),
            minScore: f.payload.minScore,
        })
        return {
            computedAt: report.computedAt?.toISOString() ?? null,
            // «Связались» (at-risk-members contacts): admins log for anyone, the
            // rest for members of their own groups — the groups left on the
            // entry after scoping.
            data: report.entries.map((e) =>
                serializeChurnRiskMember(e, isAdmin || e.groups.length > 0),
            ),
            summary: report.summary,
        }
    }
}
