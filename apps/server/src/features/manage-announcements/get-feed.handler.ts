import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { AUTHOR_SELECT } from './create-announcement.handler'
import {
    GetAnnouncementFeedFeature,
    GetAnnouncementFeedFeatureResponse,
} from './get-feed.feature'
import { serializeAnnouncement } from './schemas'

// Member-facing feed: published only, pinned first then newest. Any workspace
// member may read it (the WorkspaceMemberGuard on the route is the gate).
@Feature(GetAnnouncementFeedFeature)
export class GetAnnouncementFeedHandler
    implements
        IFeatureHandler<
            GetAnnouncementFeedFeature,
            GetAnnouncementFeedFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetAnnouncementFeedFeature) {
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? 20
        // Visible to members once the publish time has arrived (YouTube-style
        // scheduled publish). Drafts (null) and scheduled-for-later (future)
        // stay hidden; `lte` excludes nulls, so one clause covers both.
        const where = {
            workspaceId: f.workspaceId,
            publishedAt: { lte: new Date() },
        }

        const [rows, total] = await Promise.all([
            this.prisma.announcement.findMany({
                where,
                include: { author: AUTHOR_SELECT },
                orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
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
