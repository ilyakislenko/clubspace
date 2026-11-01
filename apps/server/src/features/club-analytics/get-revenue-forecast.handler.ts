import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadForecastReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'
import { GetRevenueForecastFeature, GetRevenueForecastFeatureResponse } from './get-revenue-forecast.feature'
import { serializeForecastReport } from './schemas'

@Feature(GetRevenueForecastFeature)
export class GetRevenueForecastHandler
    implements IFeatureHandler<GetRevenueForecastFeature, GetRevenueForecastFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetRevenueForecastFeature): Promise<GetRevenueForecastFeatureResponse> {
        const { scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        return serializeForecastReport(
            await loadForecastReport(this.prisma, { workspaceId: f.workspaceId, scope, now: new Date() }),
        )
    }
}
