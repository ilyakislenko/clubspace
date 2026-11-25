import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { OrgMetricsCacheService } from '../../domains/organizations/org-metrics-cache.service'
import { OrgNotifierService } from '../../domains/organizations/org-notifier.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { ConflictError, ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AcceptOrganizationInviteFeature,
    ClubOrganizationLinkResponse,
} from './club-organizations.feature'
import {
    findClubOrganizationLink,
    presentClubOrganizationLink,
} from './club-organization-links'

export const OWNER_ONLY_ACCEPT = 'Принять приглашение может только владелец клуба'

// Joining shares the legal entity's data, so only the owner decides
// (design §10); the toggles arrive as the card showed them.
@Feature(AcceptOrganizationInviteFeature)
export class AcceptOrganizationInviteHandler
    implements IFeatureHandler<AcceptOrganizationInviteFeature, ClubOrganizationLinkResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly cache: OrgMetricsCacheService,
        private readonly notifier: OrgNotifierService,
        private readonly realtime: RealtimeEmitter,
        private readonly files: FilesService,
    ) {}

    async execute(f: AcceptOrganizationInviteFeature) {
        assertOrganizationsEnabled()
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        if (!f.isSuperAdmin && ctx.workspaceOwnerId !== f.invokerUserId) {
            throw new ForbiddenError({ message: OWNER_ONLY_ACCEPT })
        }
        const link = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        if (link.status !== 'INVITED') {
            throw new ConflictError({ message: 'Приглашение уже не действует' })
        }

        const sharing = f.payload.sharing ?? {}
        const decidedAt = new Date()
        const { count } = await this.prisma.organizationClub.updateMany({
            where: { id: link.id, workspaceId: f.workspaceId, status: 'INVITED' },
            data: { status: 'ACTIVE', decidedById: f.invokerUserId, decidedAt, ...sharing },
        })
        if (count === 0) throw new ConflictError({ message: 'Приглашение уже не действует' })

        const updated = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        const club = await this.prisma.workspace.findUniqueOrThrow({
            where: { id: f.workspaceId },
            select: { name: true },
        })
        await this.cache.invalidate(link.organization.id)
        await this.audit.record({
            action: 'org.acceptInvite',
            targetType: 'organizationClub',
            targetId: link.id,
            workspaceId: f.workspaceId,
            organizationId: link.organization.id,
            actorId: f.invokerUserId,
            metadata: {
                organizationName: link.organization.name,
                clubName: club.name,
                sharing: {
                    shareRegistry: updated.shareRegistry,
                    shareMrr: updated.shareMrr,
                    shareRevenue30d: updated.shareRevenue30d,
                    allowMemberAnnouncements: updated.allowMemberAnnouncements,
                    allowMemberEvents: updated.allowMemberEvents,
                },
            },
        })
        await this.notifier.notifyOrgAdmins({
            organizationId: link.organization.id,
            kind: 'org.club_joined',
            refId: `${link.id}:${decidedAt.getTime()}`,
            topic: `Клуб «${club.name}» вступил в федерацию`,
            message: `Клуб «${club.name}» принял приглашение федерации «${link.organization.name}».`,
            workspaceId: f.workspaceId,
        })
        this.realtime.invalidate(f.workspaceId, ['organizations'])
        return presentClubOrganizationLink(this.files, updated, true)
    }
}
