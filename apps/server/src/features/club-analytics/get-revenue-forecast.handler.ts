import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadForecastReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from '../../domains/analytics/analytics-scope'
import { GetRevenueForecastFeature, GetRevenueForecastFeatureResponse } from './get-revenue-forecast.feature'
import { serializeForecastReport } from './schemas'

// Club money: the owner and admins only. Filters still narrow the club.
@Feature(GetRevenueForecastFeature)
export class GetRevenueForecastHandler
    implements IFeatureHandler<GetRevenueForecastFeature, GetRevenueForecastFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetRevenueForecastFeature): Promise<GetRevenueForecastFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const { scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        return serializeForecastReport(
            await loadForecastReport(this.prisma, { workspaceId: f.workspaceId, scope, now: new Date() }),
        )
    }
}
