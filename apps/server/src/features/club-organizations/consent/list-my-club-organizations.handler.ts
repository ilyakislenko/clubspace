import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../../infrastructure/prisma'
import {
    ListMyClubOrganizationsFeature,
    ListMyClubOrganizationsFeatureResponse,
} from './list-my-club-organizations.feature'
import { ACTIVE_LINK_SELECT, loadMyClubOrganization } from './schemas'

// Active organizations of this club with the member's own consent state —
// the switch on the club settings screen and the Home card.
@Feature(ListMyClubOrganizationsFeature)
export class ListMyClubOrganizationsHandler
    implements
        IFeatureHandler<
            ListMyClubOrganizationsFeature,
            ListMyClubOrganizationsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListMyClubOrganizationsFeature) {
        const links = await this.prisma.organizationClub.findMany({
            where: {
                workspaceId: f.workspaceId,
                status: 'ACTIVE',
                organization: { isActive: true },
            },
            select: ACTIVE_LINK_SELECT,
            orderBy: { organization: { name: 'asc' } },
        })
        const data = await Promise.all(
            links.map((l) =>
                loadMyClubOrganization(this.prisma, l, {
                    workspaceId: f.workspaceId,
                    userId: f.userId,
                    forChild: f.guardianId !== null,
                }),
            ),
        )
        return { data }
    }
}
