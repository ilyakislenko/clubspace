import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { AUTOPAY_CONSENT_VERSION } from '../../domains/autopay/autopay-consent'
import { autopayRenewalPrice } from '../../domains/autopay/autopay-offer'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    AcceptMyAutopayTermsFeature,
    AcceptMyAutopayTermsFeatureResponse,
} from './accept-my-autopay-terms.feature'
import { AUTOPAY_NOT_FOUND, loadAutopayViews } from './member-autopay-view'
import { serializeMyAutopay } from './schemas'

export const AUTOPAY_TERMS_STALE = 'Условия снова изменились — обновите экран'

// The member agrees to the tariff's current terms (a rise, another term or
// pack size): they become the agreed terms, and a stop for TERMS_CHANGED
// lifts (declines in a row are kept). Only what the screen showed is accepted.
@Feature(AcceptMyAutopayTermsFeature)
export class AcceptMyAutopayTermsHandler
    implements
        IFeatureHandler<AcceptMyAutopayTermsFeature, AcceptMyAutopayTermsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: AcceptMyAutopayTermsFeature): Promise<AcceptMyAutopayTermsFeatureResponse> {
        const now = new Date()
        const load = () =>
            loadAutopayViews(this.prisma, {
                workspaceId: f.workspaceId,
                userId: f.invokerUserId,
                now,
                id: f.autopayId,
            })
        const [view] = await load()
        if (!view) throw new NotFoundError({ message: AUTOPAY_NOT_FOUND })
        const { row } = view
        if (row.status === 'CANCELLED') {
            throw new ConflictError({ message: 'Автоплатёж уже отключён' })
        }
        const waitsForTerms = row.needsActionReason === 'TERMS_CHANGED'
        if (!row.plan || (!view.newTerms && !waitsForTerms)) {
            throw new ConflictError({ message: AUTOPAY_TERMS_STALE })
        }

        // The terms now: a TERMS_CHANGED stop whose price came back down has
        // no newTerms, and is lifted on the current ones.
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        const renewal = await autopayRenewalPrice(this.prisma, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            plan: row.plan,
            now,
            today: localDateInTz(now, workspace?.timezone ?? 'UTC'),
        })
        const p = f.payload
        if (p.consentVersion !== AUTOPAY_CONSENT_VERSION) {
            throw new BadRequestError({
                message: 'Условия автоплатежа обновились — обновите экран',
            })
        }
        if (
            p.amount !== renewal.amount ||
            p.durationDays !== row.plan.durationDays ||
            p.classCount !== row.plan.classCount
        ) {
            throw new ConflictError({ message: AUTOPAY_TERMS_STALE })
        }

        // Compare-and-set on the row read: a charge, a cancel or another
        // acceptance in between makes this one stale.
        const moved = await this.prisma.memberAutopay.updateMany({
            where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
            data: {
                termsAmount: p.amount,
                termsDurationDays: p.durationDays,
                termsClassCount: p.classCount,
                currency: row.plan.currency,
                consentVersion: p.consentVersion,
                consentedAt: now,
                ...(waitsForTerms ? { status: 'ACTIVE', needsActionReason: null } : {}),
            },
        })
        if (moved.count !== 1) throw new ConflictError({ message: AUTOPAY_TERMS_STALE })

        await this.audit.record({
            action: 'autopay.termsAccepted',
            targetType: 'member',
            targetId: f.invokerUserId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                autopayId: row.id,
                planName: row.planName,
                from: {
                    amount: row.termsAmount,
                    durationDays: row.termsDurationDays,
                    classCount: row.termsClassCount,
                },
                to: { amount: p.amount, durationDays: p.durationDays, classCount: p.classCount },
                consentVersion: p.consentVersion,
            },
        })

        const [fresh] = await load()
        return serializeMyAutopay(fresh)
    }
}
