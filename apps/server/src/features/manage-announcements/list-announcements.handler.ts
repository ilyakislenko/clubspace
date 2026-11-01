import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListAnnouncementsFeature,
    ListAnnouncementsFeatureResponse,
} from './list-announcements.feature'
import { ANNOUNCEMENT_INCLUDE, serializeAnnouncement } from './schemas'

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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 20
        // null = admin (whole club); else a direction manager sees only rows
        // of the directions they run (never club-wide or foreign ones).
        const managed = await this.rbac.assertManagesDirections(ctx)
        const asked = f.payload.directionId
        const where = {
            workspaceId: f.workspaceId,
            ...(managed === null
                ? asked
                    ? { directionId: asked }
                    : {}
                : {
                      directionId: {
                          in: asked
                              ? managed.filter((id) => id === asked)
                              : managed,
                      },
                  }),
        }

        const [rows, total] = await Promise.all([
            this.prisma.announcement.findMany({
                where,
                include: ANNOUNCEMENT_INCLUDE,
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
