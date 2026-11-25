import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { GetLeadFeature, type GetLeadFeatureResponse } from './get-lead.feature'
import { LEAD_SPORT_LEAD_ONLY, leadCaller, findLeadOr404, loadLeadClub, serializeOneLead } from './leads-utils'

@Feature(GetLeadFeature)
export class GetLeadHandler implements IFeatureHandler<GetLeadFeature, GetLeadFeatureResponse> {
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetLeadFeature): Promise<GetLeadFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const row = await findLeadOr404(this.prisma, f.workspaceId, f.leadId)
        const { timezone } = await loadLeadClub(this.prisma, f.workspaceId)
        return serializeOneLead(this.prisma, {
            workspaceId: f.workspaceId,
            timezone,
            row,
            now: new Date(),
        })
    }
}
