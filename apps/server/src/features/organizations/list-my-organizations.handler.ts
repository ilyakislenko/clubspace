import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'
import { signClubLogoUrl } from '../../domains/workspace/club-logo'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyOrganizationsFeature,
    ListMyOrganizationsFeatureResponse,
} from './list-my-organizations.feature'

// Only the caller's own memberships, active orgs only. A platform admin is
// not listed into every org here — the platform console lists them.
@Feature(ListMyOrganizationsFeature)
export class ListMyOrganizationsHandler
    implements IFeatureHandler<ListMyOrganizationsFeature, ListMyOrganizationsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(f: ListMyOrganizationsFeature) {
        assertOrganizationsEnabled()
        const rows = await this.prisma.organizationMember.findMany({
            where: { userId: f.invokerUserId, organization: { isActive: true } },
            select: {
                role: true,
                organization: {
                    select: { id: true, name: true, type: true, city: true, logoKey: true },
                },
            },
            orderBy: { organization: { name: 'asc' } },
        })
        return {
            data: await Promise.all(
                rows.map(async (r) => ({
                    id: r.organization.id,
                    name: r.organization.name,
                    type: r.organization.type,
                    city: r.organization.city,
                    logoUrl: await signClubLogoUrl(this.files, r.organization.logoKey),
                    role: r.role,
                })),
            ),
        }
    }
}
