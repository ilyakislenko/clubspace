import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import {
    LEAD_CONSENT_OUTDATED,
    LEAD_CONSENT_VERSION,
} from '../../domains/leads/lead-consent'
import { TrialRequestsCappedError } from '../../domains/leads/lead-errors'
import { notifyLeadCreated } from '../../domains/leads/lead-notifications'
import { duplicateWhere, LEAD_PUBLIC_DAILY_CAP } from '../../domains/leads/lead-rules'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { findLeadDirection } from '../leads/leads-utils'
import { normalizeLeadPhone } from '../leads/schemas'
import {
    CreatePublicTrialRequestFeature,
    type CreatePublicTrialRequestFeatureResponse,
} from './create-public-trial-request.feature'
import { findTrialClub } from './schemas'

const DAY_MS = 24 * 60 * 60_000

export const TRIAL_CONSENT_REQUIRED =
    'Нужно согласие на обработку персональных данных'

// «12.11.2026: хочу в субботу» — a repeat request's words, dated in the club's zone.
export const resubmissionNote = (now: Date, timezone: string, comment: string | undefined) =>
    `${new Intl.DateTimeFormat('ru-RU', { timeZone: timezone }).format(now)}: ${
        comment?.trim() || 'повторная заявка'
    }`

// A merged lead's comment stops growing past this (a resubmission makes no
// row, so the daily cap never trips on it).
export const LEAD_MERGED_COMMENT_MAX = 4_000

// docs/design/2026-11-26-leads.md §3.2, in this order: the honeypot, the
// consent, the club's daily cap, the duplicate merge, the new lead.
@Feature(CreatePublicTrialRequestFeature)
export class CreatePublicTrialRequestHandler
    implements
        IFeatureHandler<CreatePublicTrialRequestFeature, CreatePublicTrialRequestFeatureResponse>
{
    private readonly logger = new Logger(CreatePublicTrialRequestHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(f: CreatePublicTrialRequestFeature) {
        const received = { status: 'received' as const }
        const { payload, now } = f
        const ws = await findTrialClub(this.prisma, f.slug)
        // A bot filled the hidden field: answer like a success, store nothing.
        if (payload.website?.trim()) return received
        if (!payload.consent) {
            throw new BadRequestError({ message: TRIAL_CONSENT_REQUIRED })
        }
        if (payload.consentVersion !== LEAD_CONSENT_VERSION) {
            throw new BadRequestError({ message: LEAD_CONSENT_OUTDATED })
        }
        const phone = normalizeLeadPhone(payload.phone)

        const lastDay = await this.prisma.lead.count({
            where: {
                workspaceId: ws.id,
                createdById: null,
                createdAt: { gte: new Date(now.getTime() - DAY_MS) },
            },
        })
        if (lastDay >= LEAD_PUBLIC_DAILY_CAP) {
            this.logger.warn(`trial requests capped for workspace ${ws.id}`)
            throw new TrialRequestsCappedError()
        }

        const consent = {
            consentVersion: LEAD_CONSENT_VERSION,
            consentAt: now,
            consentIp: f.ip?.slice(0, 64) ?? null,
            consentUserAgent: f.userAgent?.slice(0, 512) ?? null,
        }

        // The same phone again within the window: the person's new words are
        // appended to the open lead — no new row, no second push. The first
        // consent evidence stays (anyone knowing the phone could resubmit;
        // `resubmittedAt` records the repeat), and the comment stops growing
        // at LEAD_MERGED_COMMENT_MAX.
        const duplicate = await this.prisma.lead.findFirst({
            where: duplicateWhere({ workspaceId: ws.id, phone, now }),
            select: { id: true, comment: true },
            orderBy: { createdAt: 'desc' },
        })
        if (duplicate) {
            const note = resubmissionNote(now, ws.timezone, payload.comment)
            const full = (duplicate.comment?.length ?? 0) >= LEAD_MERGED_COMMENT_MAX
            await this.prisma.lead.update({
                where: { id: duplicate.id },
                data: {
                    ...(full
                        ? {}
                        : { comment: duplicate.comment ? `${duplicate.comment}\n${note}` : note }),
                    resubmittedAt: now,
                },
            })
            this.realtime.invalidate(ws.id, ['leads'])
            return received
        }

        const direction = await findLeadDirection(this.prisma, ws.id, payload.directionId)
        const source = payload.source === 'qr' ? 'QR' : 'PUBLIC_PAGE'
        const lead = await this.prisma.lead.create({
            data: {
                workspaceId: ws.id,
                source,
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
                ...consent,
                createdAt: now,
            },
            select: { id: true, directionName: true },
        })

        await this.audit.record({
            action: 'lead.create',
            targetType: 'lead',
            targetId: lead.id,
            workspaceId: ws.id,
            actorId: null,
            metadata: { leadSource: source },
        })
        this.realtime.invalidate(ws.id, ['leads'])
        try {
            await notifyLeadCreated(
                { prisma: this.prisma, notifications: this.notifications },
                { workspaceId: ws.id, ownerId: ws.ownerId, exceptUserId: null, lead },
            )
        } catch (error) {
            this.logger.warn(
                `lead ${lead.id} saved, notifications failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
        return received
    }
}
