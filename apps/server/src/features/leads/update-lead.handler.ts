import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { AuditService } from '../../domains/audit/services/audit.service'
import { LeadDuplicateError } from '../../domains/leads/lead-errors'
import { duplicateWhere } from '../../domains/leads/lead-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { type Prisma, PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { claimUnchanged } from '../../shared/utils/optimistic-concurrency'
import { LEAD_DIRECTION_NOT_FOUND } from './create-lead.handler'
import {
    LEAD_SPORT_LEAD_ONLY,
    leadCaller,
    findLeadDirection,
    findLeadOr404,
    loadLeadClub,
    serializeOneLead,
} from './leads-utils'
import {
    LEAD_ANONYMIZED,
    LEAD_CHILD_REQUIRED,
    LEAD_EMAIL_INVALID,
    leadSelect,
    normalizeLeadPhone,
} from './schemas'
import { UpdateLeadFeature, type UpdateLeadFeatureResponse } from './update-lead.feature'

@Feature(UpdateLeadFeature)
export class UpdateLeadHandler
    implements IFeatureHandler<UpdateLeadFeature, UpdateLeadFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UpdateLeadFeature): Promise<UpdateLeadFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { payload, workspaceId, leadId } = f
        const now = new Date()
        const current = await findLeadOr404(this.prisma, workspaceId, leadId)
        if (current.anonymizedAt) throw new BadRequestError({ message: LEAD_ANONYMIZED })

        const data: Prisma.LeadUpdateInput = {}
        if (payload.name !== undefined) data.name = payload.name
        if (payload.phone !== undefined) {
            const phone = normalizeLeadPhone(payload.phone)
            if (phone !== current.phone) {
                const duplicate = await this.prisma.lead.findFirst({
                    where: { ...duplicateWhere({ workspaceId, phone, now }), id: { not: leadId } },
                    select: { id: true },
                })
                if (duplicate) throw new LeadDuplicateError(duplicate.id)
            }
            data.phone = phone
        }
        if (payload.email !== undefined) {
            if (payload.email && !z.email().safeParse(payload.email).success) {
                throw new BadRequestError({ message: LEAD_EMAIL_INVALID })
            }
            data.email = payload.email || null
        }
        if (payload.directionId !== undefined) {
            const direction = await findLeadDirection(this.prisma, workspaceId, payload.directionId)
            if (payload.directionId && !direction) {
                throw new BadRequestError({ message: LEAD_DIRECTION_NOT_FOUND })
            }
            data.direction = direction
                ? { connect: { id: direction.directionId } }
                : { disconnect: true }
            data.directionName = direction?.directionName ?? null
        }
        if (payload.staffNote !== undefined) data.staffNote = payload.staffNote || null

        // The child block is checked as it will be after the save.
        const forChild = payload.forChild ?? current.forChild
        const childName =
            payload.childName !== undefined ? payload.childName || null : current.childName
        const childAge = payload.childAge !== undefined ? payload.childAge : current.childAge
        if (forChild && (!childName || childAge === null)) {
            throw new BadRequestError({ message: LEAD_CHILD_REQUIRED })
        }
        if (
            payload.forChild !== undefined ||
            payload.childName !== undefined ||
            payload.childAge !== undefined
        ) {
            data.forChild = forChild
            data.childName = forChild ? childName : null
            data.childAge = forChild ? childAge : null
        }

        const row = await this.prisma.$transaction(async (tx) => {
            await claimUnchanged(payload.expectedUpdatedAt, (expected) =>
                tx.lead.updateMany({
                    where: { id: leadId, workspaceId, updatedAt: expected },
                    data: { updatedAt: new Date() },
                }),
            )
            return tx.lead.update({ where: { id: leadId }, data, select: leadSelect })
        })

        // Field names only: the journal never holds a lead's personal data.
        // `personName`, so the journal's labels don't read it as a title.
        const fields = Object.keys(payload)
            .filter(
                (k) => k !== 'expectedUpdatedAt' && payload[k as keyof typeof payload] !== undefined,
            )
            .map((k) => (k === 'name' ? 'personName' : k))
        await this.audit.record({
            action: 'lead.update',
            targetType: 'lead',
            targetId: leadId,
            workspaceId,
            actorId: f.invokerUserId,
            metadata: { fields },
        })
        this.realtime.invalidate(workspaceId, ['leads'])

        const { timezone } = await loadLeadClub(this.prisma, workspaceId)
        return serializeOneLead(this.prisma, { workspaceId, timezone, row, now })
    }
}
