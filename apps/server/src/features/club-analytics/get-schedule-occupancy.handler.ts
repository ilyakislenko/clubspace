import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadOccupancyReport } from '../../domains/analytics/analytics-reports'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'
import { GetScheduleOccupancyFeature, GetScheduleOccupancyFeatureResponse } from './get-schedule-occupancy.feature'
import { serializeOccupancyReport } from './schemas'

@Feature(GetScheduleOccupancyFeature)
export class GetScheduleOccupancyHandler
    implements IFeatureHandler<GetScheduleOccupancyFeature, GetScheduleOccupancyFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetScheduleOccupancyFeature): Promise<GetScheduleOccupancyFeatureResponse> {
        const { scope } = await resolveAnalyticsScope(this.prisma, this.rbac, f, f.payload)
        return serializeOccupancyReport(
            await loadOccupancyReport(this.prisma, {
                workspaceId: f.workspaceId,
                scope,
                now: new Date(),
                weeks: f.payload.weeks,
            }),
        )
    }
}
