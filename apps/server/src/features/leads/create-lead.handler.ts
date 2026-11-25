import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { LEAD_CONSENT_VERSION } from '../../domains/leads/lead-consent'
import { LeadDuplicateError } from '../../domains/leads/lead-errors'
import { notifyLeadCreated } from '../../domains/leads/lead-notifications'
import { duplicateWhere } from '../../domains/leads/lead-rules'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { CreateLeadFeature, type CreateLeadFeatureResponse } from './create-lead.feature'
import {
    LEAD_SPORT_LEAD_ONLY,
    leadCaller,
    findLeadDirection,
    loadLeadClub,
    serializeOneLead,
} from './leads-utils'
import { leadSelect, normalizeLeadPhone } from './schemas'

export const LEAD_DIRECTION_NOT_FOUND = 'Направление не найдено'

@Feature(CreateLeadFeature)
export class CreateLeadHandler
    implements IFeatureHandler<CreateLeadFeature, CreateLeadFeatureResponse>
{
    private readonly logger = new Logger(CreateLeadHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(f: CreateLeadFeature): Promise<CreateLeadFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { payload, workspaceId } = f
        const now = new Date()
        const phone = normalizeLeadPhone(payload.phone)
        const club = await loadLeadClub(this.prisma, workspaceId)

        const direction = await findLeadDirection(this.prisma, workspaceId, payload.directionId)
        if (payload.directionId && !direction) {
            throw new BadRequestError({ message: LEAD_DIRECTION_NOT_FOUND })
        }

        const duplicate = await this.prisma.lead.findFirst({
            where: duplicateWhere({ workspaceId, phone, now }),
            select: { id: true },
        })
        if (duplicate) throw new LeadDuplicateError(duplicate.id)

        const row = await this.prisma.lead.create({
            data: {
                workspaceId,
                source: 'MANUAL',
                status: 'NEW',
                statusChangedAt: now,
                name: payload.name,
                phone,
                email: payload.email || null,
                forChild: payload.forChild,
                childName: payload.forChild ? (payload.childName ?? null) : null,
                childAge: payload.forChild ? (payload.childAge ?? null) : null,
                directionId: direction?.directionId ?? null,
                directionName: direction?.directionName ?? null,
                comment: payload.comment || null,
                staffNote: payload.staffNote || null,
                consentVersion: LEAD_CONSENT_VERSION,
                consentAt: now,
                consentRecordedById: f.invokerUserId,
                createdById: f.invokerUserId,
                createdAt: now,
            },
            select: leadSelect,
        })

        await this.audit.record({
            action: 'lead.create',
            targetType: 'lead',
            targetId: row.id,
            workspaceId,
            actorId: f.invokerUserId,
            metadata: { leadSource: 'MANUAL' },
        })
        this.realtime.invalidate(workspaceId, ['leads'])
        try {
            await notifyLeadCreated(
                { prisma: this.prisma, notifications: this.notifications },
                {
                    workspaceId,
                    ownerId: club.ownerId,
                    exceptUserId: f.invokerUserId,
                    lead: row,
                },
            )
        } catch (error) {
            this.logger.warn(
                `lead ${row.id} saved, notifications failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }

        return serializeOneLead(this.prisma, {
            workspaceId,
            timezone: club.timezone,
            row,
            now,
        })
    }
}
