import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    loadMyDependentLink,
    withdrawDependentConsent,
} from './dependent-access'
import {
    UnlinkMyDependentFeature,
    UnlinkMyDependentFeatureResponse,
} from './my-dependents.feature'

// Removes the caller's own guardianship. A pending one (a club's invitation)
// can always be declined. A confirmed one only while another confirmed
// guardian remains — otherwise the child would be left with nobody able to
// reach it, so the last guardian deletes the profile instead.
@Feature(UnlinkMyDependentFeature)
export class UnlinkMyDependentHandler
    implements
        IFeatureHandler<UnlinkMyDependentFeature, UnlinkMyDependentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        guardianId,
        dependentId,
    }: UnlinkMyDependentFeature): Promise<UnlinkMyDependentFeatureResponse> {
        const link = await loadMyDependentLink(
            this.prisma,
            guardianId,
            dependentId,
        )

        if (link.consentAt) {
            const others = await this.prisma.guardianship.count({
                where: {
                    dependentId,
                    guardianId: { not: guardianId },
                    consentAt: { not: null },
                    guardian: { status: 'ACTIVE' },
                },
            })
            if (others === 0) {
                throw new BadRequestError({
                    message:
                        'Вы единственный родитель в этом профиле. Чтобы убрать ребёнка, удалите его профиль',
                })
            }
        }

        await this.prisma.guardianship.delete({ where: { id: link.id } })
        await withdrawDependentConsent(this.prisma, { guardianId, dependentId })

        await this.audit.record({
            action: 'guardian.unlinkDependent',
            targetType: 'member',
            targetId: dependentId,
            workspaceId: link.invitedByWorkspace?.id ?? null,
            actorId: guardianId,
            metadata: { wasConfirmed: link.consentAt !== null },
        })
        for (const club of link.dependent.workspaceMemberships) {
            this.realtime.invalidate(club.workspace.id, ['members'])
        }

        return { status: 'unlinked' }
    }
}
