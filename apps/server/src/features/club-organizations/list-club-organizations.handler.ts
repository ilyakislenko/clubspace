import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListClubOrganizationsFeature,
    ListClubOrganizationsFeatureResponse,
} from './club-organizations.feature'
import { presentClubOrganizationLink } from './club-organization-links'
import { CLUB_ORG_LINK_SELECT } from './schemas'

// Every link but REMOVED (an exclusion is the org's act; the club keeps no
// card for it). An empty list hides «Настройки → Федерация».
@Feature(ListClubOrganizationsFeature)
export class ListClubOrganizationsHandler
    implements IFeatureHandler<ListClubOrganizationsFeature, ListClubOrganizationsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly files: FilesService,
    ) {}

    async execute({ workspaceId, invokerUserId, roleName, isSuperAdmin }: ListClubOrganizationsFeature) {
        assertOrganizationsEnabled()
        const ctx = await assertClubAdmin(this.rbac, {
            userId: invokerUserId,
            workspaceId,
            roleName,
            isSuperAdmin,
        })
        const rows = await this.prisma.organizationClub.findMany({
            where: {
                workspaceId,
                status: { not: 'REMOVED' },
                organization: { isActive: true },
            },
            select: CLUB_ORG_LINK_SELECT,
            orderBy: { invitedAt: 'desc' },
        })
        const canAccept = isSuperAdmin || ctx.workspaceOwnerId === invokerUserId
        return {
            data: await Promise.all(
                rows.map((r) => presentClubOrganizationLink(this.files, r, canAccept)),
            ),
        }
    }
}
