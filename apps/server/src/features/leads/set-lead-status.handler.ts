import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { leadTrialBookedText } from '../../domains/leads/lead-notifications'
import {
    anonymizeData,
    canMoveLead,
    leadStatusStamp,
} from '../../domains/leads/lead-rules'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { type Prisma, PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    ConflictError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { wallClockToUtc } from '../attendance/attendance-utils'
import { LEAD_SPORT_LEAD_ONLY, leadCaller, findLeadOr404, loadLeadClub, serializeOneLead } from './leads-utils'
import { LEAD_ANONYMIZED, leadSelect } from './schemas'
import { SetLeadStatusFeature, type SetLeadStatusFeatureResponse } from './set-lead-status.feature'

export const LEAD_STATUS_CHANGED = 'Статус заявки изменился — обновите экран'
export const LEAD_MOVE_REFUSED = 'Так перевести заявку нельзя'
export const LEAD_TRIAL_AT_REQUIRED = 'Укажите дату и время пробного'
export const LEAD_LOST_REASON_REQUIRED = 'Укажите причину отказа'
export const LEAD_LOST_COMMENT_REQUIRED = 'Опишите причину отказа в комментарии'
export const LEAD_GROUP_NOT_FOUND = 'Группа не найдена'

@Feature(SetLeadStatusFeature)
export class SetLeadStatusHandler
    implements IFeatureHandler<SetLeadStatusFeature, SetLeadStatusFeatureResponse>
{
    private readonly logger = new Logger(SetLeadStatusHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(f: SetLeadStatusFeature): Promise<SetLeadStatusFeatureResponse> {
        await assertSportLead(this.rbac, leadCaller(f), LEAD_SPORT_LEAD_ONLY)
        const { payload, workspaceId, leadId, now } = f
        const { from, to } = payload
        const current = await findLeadOr404(this.prisma, workspaceId, leadId)
        if (current.anonymizedAt) throw new BadRequestError({ message: LEAD_ANONYMIZED })
        if (!canMoveLead(from, to)) throw new BadRequestError({ message: LEAD_MOVE_REFUSED })
        const club = await loadLeadClub(this.prisma, workspaceId)

        const data: Prisma.LeadUpdateManyMutationInput = leadStatusStamp(to, now, current)
        let group: { id: string; name: string; coachId: string; timezone: string } | null = null
        if (to === 'TRIAL_BOOKED') {
            if (!payload.trialAt) {
                throw new BadRequestError({ message: LEAD_TRIAL_AT_REQUIRED })
            }
            if (payload.trialGroupId) {
                const row = await this.prisma.group.findFirst({
                    where: { id: payload.trialGroupId, workspaceId },
                    select: { id: true, name: true, coachId: true, gym: { select: { timezone: true } } },
                })
                if (!row) throw new BadRequestError({ message: LEAD_GROUP_NOT_FOUND })
                group = {
                    id: row.id,
                    name: row.name,
                    coachId: row.coachId,
                    timezone: row.gym?.timezone ?? club.timezone,
                }
            }
            Object.assign(data, {
                trialAt: wallClockToUtc(payload.trialAt, group?.timezone ?? club.timezone),
                trialGroupId: group?.id ?? null,
                trialGroupName: group?.name ?? null,
            })
        }
        if (to === 'LOST') {
            if (!payload.lostReason) {
                throw new BadRequestError({ message: LEAD_LOST_REASON_REQUIRED })
            }
            if (payload.lostReason === 'OTHER' && !payload.lostComment) {
                throw new BadRequestError({ message: LEAD_LOST_COMMENT_REQUIRED })
            }
            Object.assign(data, {
                lostReason: payload.lostReason,
                lostComment: payload.lostComment || null,
                // Spam is erased at once and drops out of every report.
                ...(payload.lostReason === 'SPAM' ? anonymizeData(now) : {}),
            })
        }

        // Compare-and-set on the status the screen showed.
        const { count } = await this.prisma.lead.updateMany({
            where: { id: leadId, workspaceId, status: from, anonymizedAt: null },
            data,
        })
        if (count === 0) throw new ConflictError({ message: LEAD_STATUS_CHANGED })

        await this.audit.record({
            action: 'lead.setStatus',
            targetType: 'lead',
            targetId: leadId,
            workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                fromStatus: from,
                toStatus: to,
                ...(to === 'LOST' ? { lostReason: payload.lostReason } : {}),
            },
        })
        this.realtime.invalidate(workspaceId, ['leads'])

        const row = await this.prisma.lead.findFirstOrThrow({
            where: { id: leadId },
            select: leadSelect,
        })
        if (to === 'TRIAL_BOOKED' && group && payload.notifyCoach && row.trialAt) {
            await this.notifyCoach(workspaceId, row, group)
        }
        return serializeOneLead(this.prisma, {
            workspaceId,
            timezone: club.timezone,
            row,
            now,
        })
    }

    // «на пробное придёт Анна, пт 18:00» to the group's primary coach: a name
    // and a time, never the phone. A reschedule is a new heads-up.
    private async notifyCoach(
        workspaceId: string,
        lead: { id: string; trialAt: Date | null },
        group: { name: string; coachId: string; timezone: string },
    ) {
        if (!lead.trialAt) return
        try {
            await this.notifications.notifyUser({
                userId: group.coachId,
                kind: 'lead.trialBooked',
                refId: `${lead.id}:${lead.trialAt.toISOString()}:${group.coachId}`,
                ...leadTrialBookedText({
                    trialAt: lead.trialAt,
                    timeZone: group.timezone,
                    groupName: group.name,
                }),
                link: null,
                workspaceId,
                metadata: { workspaceId, leadId: lead.id },
            })
        } catch (error) {
            this.logger.warn(
                `lead ${lead.id}: coach heads-up failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }
}
