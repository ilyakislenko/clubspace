import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { BadRequestError, ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { LEAD_SPORT_LEAD_ONLY, leadCaller, findLeadOr404, loadLeadClub, serializeOneLead } from './leads-utils'
import {
    LinkLeadMemberFeature,
    type LinkLeadMemberFeatureResponse,
} from './link-lead-member.feature'
import { LEAD_ANONYMIZED, leadSelect } from './schemas'

export const LEAD_LINK_NOT_STUDENT = 'Свяжите заявку с учеником этого клуба'
export const LEAD_LINKED_ELSEWHERE = 'Заявка уже связана с другим учеником'

@Feature(LinkLeadMemberFeature)
export class LinkLeadMemberHandler
    implements IFeatureHandler<LinkLeadMemberFeature, LinkLeadMemberFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: LinkLeadMemberFeature): Promise<LinkLeadMemberFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { workspaceId, leadId, now } = f
        const { userId } = f.payload
        const current = await findLeadOr404(this.prisma, workspaceId, leadId)
        if (current.anonymizedAt) throw new BadRequestError({ message: LEAD_ANONYMIZED })
        const club = await loadLeadClub(this.prisma, workspaceId)
        const serialize = (row: typeof current) =>
            serializeOneLead(this.prisma, { workspaceId, timezone: club.timezone, row, now })

        if (current.convertedUserId === userId) return serialize(current)
        if (current.convertedUserId) throw new ConflictError({ message: LEAD_LINKED_ELSEWHERE })

        // A student of this club (a child counts: dependents are `user`
        // members too); never staff, never another club's person.
        const member = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId, userId, status: 'ACTIVE', role: { name: 'user' } },
            select: { id: true },
        })
        if (!member) throw new BadRequestError({ message: LEAD_LINK_NOT_STUDENT })

        // Joining the club means the person came: any earlier status (a lost
        // one included) moves to CAME. Set only while still unlinked, so two
        // staff linking different students can't both win.
        const { count } = await this.prisma.lead.updateMany({
            where: { id: leadId, workspaceId, convertedUserId: null, anonymizedAt: null },
            data: {
                convertedUserId: userId,
                convertedAt: now,
                ...(current.status === 'CAME'
                    ? {}
                    : {
                          status: 'CAME',
                          statusChangedAt: now,
                          lostAt: null,
                          lostReason: null,
                          lostComment: null,
                      }),
                ...(current.cameAt ? {} : { cameAt: now }),
                ...(current.contactedAt ? {} : { contactedAt: now }),
            },
        })
        if (count === 0) {
            const again = await findLeadOr404(this.prisma, workspaceId, leadId)
            if (again.convertedUserId === userId) return serialize(again)
            throw new ConflictError({ message: LEAD_LINKED_ELSEWHERE })
        }

        await this.audit.record({
            action: 'lead.link',
            targetType: 'lead',
            targetId: leadId,
            workspaceId,
            actorId: f.invokerUserId,
            metadata: { userId },
        })
        this.realtime.invalidate(workspaceId, ['leads'])
        return serialize(
            await this.prisma.lead.findFirstOrThrow({ where: { id: leadId }, select: leadSelect }),
        )
    }
}
