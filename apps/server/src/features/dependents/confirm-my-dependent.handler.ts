import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    loadMyDependentLink,
    recordDependentConsent,
} from './dependent-access'
import { GUARDIAN_CONSENT_VERSION } from './dependents-utils'
import {
    ConfirmMyDependentFeature,
    ConfirmMyDependentFeatureResponse,
} from './my-dependents.feature'
import { myDependentSelect, serializeMyDependent } from './schemas'

// The guardian accepts a club's «Добавить ребёнка»: the pending link becomes
// a confirmed one, and the consent is recorded now — by the guardian, never
// by the club. Confirming twice keeps the first consent.
@Feature(ConfirmMyDependentFeature)
export class ConfirmMyDependentHandler
    implements
        IFeatureHandler<
            ConfirmMyDependentFeature,
            ConfirmMyDependentFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        guardianId,
        dependentId,
        ip,
        userAgent,
    }: ConfirmMyDependentFeature): Promise<ConfirmMyDependentFeatureResponse> {
        const link = await loadMyDependentLink(
            this.prisma,
            guardianId,
            dependentId,
        )
        if (link.consentAt) return serializeMyDependent(link)

        // Conditional on still pending, so two taps can't both stamp; only
        // the tap that stamped records the evidence.
        const stamped = await this.prisma.guardianship.updateMany({
            where: { id: link.id, consentAt: null },
            data: {
                consentAt: new Date(),
                consentVersion: GUARDIAN_CONSENT_VERSION,
                ...(payload.relation ? { relation: payload.relation } : {}),
            },
        })
        if (stamped.count > 0) {
            await recordDependentConsent(this.prisma, {
                guardianId,
                dependentId,
                version: GUARDIAN_CONSENT_VERSION,
                ip,
                userAgent,
            })
        }
        const row = await this.prisma.guardianship.findUniqueOrThrow({
            where: { id: link.id },
            select: myDependentSelect,
        })

        const workspaceId = row.invitedByWorkspace?.id ?? null
        await this.audit.record({
            action: 'guardian.confirmDependent',
            targetType: 'member',
            targetId: dependentId,
            workspaceId,
            actorId: guardianId,
            metadata: { consentVersion: GUARDIAN_CONSENT_VERSION },
        })
        // The club's roster shows the guardian as confirmed now.
        if (workspaceId) this.realtime.invalidate(workspaceId, ['members'])

        return serializeMyDependent(row)
    }
}
