import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { loadOrgClubLink } from '../../domains/organizations/club-links'
import { assertOrgAdmin, OrgRbacService } from '../../domains/organizations/org-access'
import { OrgMetricsCacheService } from '../../domains/organizations/org-metrics-cache.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { ConflictError, NotFoundError } from '../../shared/errors/shared.errors'
import {
    RemoveClubFromOrganizationFeature,
    RemoveClubFromOrganizationFeatureResponse,
} from './remove-club-from-organization.feature'

// «Отозвать приглашение» / «Исключить из федерации»: the club stops sharing
// at once (numbers, registry, its members' event sign-ups through it).
@Feature(RemoveClubFromOrganizationFeature)
export class RemoveClubFromOrganizationHandler
    implements
        IFeatureHandler<RemoveClubFromOrganizationFeature, RemoveClubFromOrganizationFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
        private readonly audit: AuditService,
        private readonly cache: OrgMetricsCacheService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({ organizationId, linkId, invokerUserId, isSuperAdmin }: RemoveClubFromOrganizationFeature) {
        await assertOrgAdmin(
            this.orgRbac,
            { userId: invokerUserId, organizationId, isSuperAdmin },
            'Исключать клубы может администратор федерации',
        )
        const link = await loadOrgClubLink(this.prisma, organizationId, linkId)
        if (!link) throw new NotFoundError({ message: 'Клуб не найден в федерации' })

        const { count } = await this.prisma.organizationClub.updateMany({
            where: { id: link.id, status: { in: ['INVITED', 'ACTIVE'] } },
            data: { status: 'REMOVED', decidedById: invokerUserId, decidedAt: new Date() },
        })
        if (count === 0) {
            throw new ConflictError({ message: `Клуб «${link.club.name}» уже не в федерации` })
        }

        await this.cache.invalidate(organizationId)
        await this.audit.record({
            action: 'org.removeClub',
            targetType: 'organizationClub',
            targetId: link.id,
            organizationId,
            workspaceId: null,
            actorId: invokerUserId,
            metadata: { clubName: link.club.name, fromStatus: link.status },
        })
        this.realtime.invalidate(link.club.workspaceId, ['organizations'])
        return { success: true as const }
    }
}
