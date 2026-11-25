import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { anonymizeData } from '../../domains/leads/lead-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { EraseLeadFeature, type EraseLeadFeatureResponse } from './erase-lead.feature'
import { LEAD_SPORT_LEAD_ONLY, leadCaller, findLeadOr404, loadLeadClub, serializeOneLead } from './leads-utils'
import { leadSelect } from './schemas'

// Idempotent: erasing an anonymised lead answers it as it is.
@Feature(EraseLeadFeature)
export class EraseLeadHandler
    implements IFeatureHandler<EraseLeadFeature, EraseLeadFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: EraseLeadFeature): Promise<EraseLeadFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { workspaceId, leadId, now } = f
        const current = await findLeadOr404(this.prisma, workspaceId, leadId)
        const club = await loadLeadClub(this.prisma, workspaceId)
        let row = current
        if (!current.anonymizedAt) {
            row = await this.prisma.lead.update({
                where: { id: leadId },
                data: anonymizeData(now),
                select: leadSelect,
            })
            await this.audit.record({
                action: 'lead.erase',
                targetType: 'lead',
                targetId: leadId,
                workspaceId,
                actorId: f.invokerUserId,
                metadata: {},
            })
            this.realtime.invalidate(workspaceId, ['leads'])
        }
        return serializeOneLead(this.prisma, { workspaceId, timezone: club.timezone, row, now })
    }
}
