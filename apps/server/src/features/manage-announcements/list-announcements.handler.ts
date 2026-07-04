import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { AUTHOR_SELECT } from './create-announcement.handler'
import {
    ListAnnouncementsFeature,
    ListAnnouncementsFeatureResponse,
} from './list-announcements.feature'
import { serializeAnnouncement } from './schemas'

// Staff view: includes drafts (publishedAt = null). Pinned first, then newest.
@Feature(ListAnnouncementsFeature)
export class ListAnnouncementsHandler
    implements
        IFeatureHandler<
            ListAnnouncementsFeature,
            ListAnnouncementsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListAnnouncementsFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 20
        const where = { workspaceId: f.workspaceId }

        const [rows, total] = await Promise.all([
            this.prisma.announcement.findMany({
                where,
                include: { author: AUTHOR_SELECT },
                orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
                skip: (curPage - 1) * perPage,
                take: perPage,
            }),
            this.prisma.announcement.count({ where }),
        ])
        return {
            data: rows.map(serializeAnnouncement),
            total,
            curPage,
            perPage,
        }
    }
}
