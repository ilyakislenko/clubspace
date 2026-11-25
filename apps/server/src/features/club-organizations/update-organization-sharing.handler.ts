import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { OrgMetricsCacheService } from '../../domains/organizations/org-metrics-cache.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ClubOrganizationLinkResponse,
    UpdateOrganizationSharingFeature,
} from './club-organizations.feature'
import {
    findClubOrganizationLink,
    presentClubOrganizationLink,
} from './club-organization-links'
import { changedSharing } from './schemas'

// The sharing toggles of an ACTIVE membership, saved per toggle and audited.
// Money shows in the org console only while its toggle is on; the org's
// numbers cache is dropped so the change is visible on the next read.
@Feature(UpdateOrganizationSharingFeature)
export class UpdateOrganizationSharingHandler
    implements IFeatureHandler<UpdateOrganizationSharingFeature, ClubOrganizationLinkResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly cache: OrgMetricsCacheService,
        private readonly realtime: RealtimeEmitter,
        private readonly files: FilesService,
    ) {}

    async execute(f: UpdateOrganizationSharingFeature) {
        assertOrganizationsEnabled()
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const link = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        const { count } = await this.prisma.organizationClub.updateMany({
            where: { id: link.id, workspaceId: f.workspaceId, status: 'ACTIVE' },
            data: f.payload,
        })
        if (count === 0) {
            throw new ConflictError({ message: 'Клуб не состоит в этой федерации' })
        }
        const changes = changedSharing(link, f.payload)
        if (Object.keys(changes).length > 0) {
            await this.cache.invalidate(link.organization.id)
            // clubName labels the entry in the org's journal (club actors are
            // stripped there).
            const club = await this.prisma.workspace.findUniqueOrThrow({
                where: { id: f.workspaceId },
                select: { name: true },
            })
            await this.audit.record({
                action: 'org.updateSharing',
                targetType: 'organizationClub',
                targetId: link.id,
                workspaceId: f.workspaceId,
                organizationId: link.organization.id,
                actorId: f.invokerUserId,
                metadata: { organizationName: link.organization.name, clubName: club.name, changes },
            })
            this.realtime.invalidate(f.workspaceId, ['organizations'])
        }
        const updated = await findClubOrganizationLink(this.prisma, f.workspaceId, f.linkId)
        return presentClubOrganizationLink(
            this.files,
            updated,
            f.isSuperAdmin || ctx.workspaceOwnerId === f.invokerUserId,
        )
    }
}
