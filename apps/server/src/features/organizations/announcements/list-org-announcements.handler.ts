import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    assertOrgStaff,
    OrgRbacService,
} from '../../../domains/organizations/org-access'
import { PrismaService } from '../../../infrastructure/prisma'
import {
    ListOrgAnnouncementsFeature,
    ListOrgAnnouncementsFeatureResponse,
} from './list-org-announcements.feature'
import { serializeOrgAnnouncement } from './schemas'

// Drafts and scheduled ones first, then the newest published.
@Feature(ListOrgAnnouncementsFeature)
export class ListOrgAnnouncementsHandler
    implements
        IFeatureHandler<
            ListOrgAnnouncementsFeature,
            ListOrgAnnouncementsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly orgRbac: OrgRbacService,
    ) {}

    async execute(f: ListOrgAnnouncementsFeature) {
        await assertOrgStaff(this.orgRbac, {
            userId: f.invokerUserId,
            organizationId: f.organizationId,
            isSuperAdmin: f.isSuperAdmin,
        })
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 20
        const where = { organizationId: f.organizationId }
        const [rows, total] = await Promise.all([
            this.prisma.organizationAnnouncement.findMany({
                where,
                orderBy: [
                    { publishedAt: { sort: 'desc', nulls: 'first' } },
                    { createdAt: 'desc' },
                ],
                skip: (curPage - 1) * perPage,
                take: perPage,
            }),
            this.prisma.organizationAnnouncement.count({ where }),
        ])
        return { data: rows.map(serializeOrgAnnouncement), total, curPage, perPage }
    }
}
