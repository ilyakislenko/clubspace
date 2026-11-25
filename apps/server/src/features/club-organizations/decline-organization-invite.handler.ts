import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ClubOrganizationLinkResponse,
    DeclineOrganizationInviteFeature,
} from './club-organizations.feature'
import {
    findClubOrganizationLink,
    presentClubOrganizationLink,
} from './club-organization-links'

// Declining shares nothing, so any club admin may (design §1).
@Feature(DeclineOrganizationInviteFeature)
export class DeclineOrganizationInviteHandler
    implements IFeatureHandler<DeclineOrganizationInviteFeature, ClubOrganizationLinkResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
        private readonly files: FilesService,
    ) {}

    async execute(f: DeclineOrganizationInviteFeature) {
        assertOrganizationsEnabled()
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const link = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        const { count } = await this.prisma.organizationClub.updateMany({
            where: { id: link.id, workspaceId: f.workspaceId, status: 'INVITED' },
            data: { status: 'DECLINED', decidedById: f.invokerUserId, decidedAt: new Date() },
        })
        if (count === 0) throw new ConflictError({ message: 'Приглашение уже не действует' })

        const club = await this.prisma.workspace.findUniqueOrThrow({
            where: { id: f.workspaceId },
            select: { name: true },
        })
        await this.audit.record({
            action: 'org.declineInvite',
            targetType: 'organizationClub',
            targetId: link.id,
            workspaceId: f.workspaceId,
            organizationId: link.organization.id,
            actorId: f.invokerUserId,
            metadata: { organizationName: link.organization.name, clubName: club.name },
        })
        this.realtime.invalidate(f.workspaceId, ['organizations'])
        const updated = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        return presentClubOrganizationLink(
            this.files,
            updated,
            f.isSuperAdmin || ctx.workspaceOwnerId === f.invokerUserId,
        )
    }
}
