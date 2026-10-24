import { Feature, IFeatureHandler } from '@shelfjs/features'

import { isAwaitingFirstVisit } from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { AUTHOR_SELECT } from './create-announcement.handler'
import {
    GetAnnouncementFeedFeature,
    GetAnnouncementFeedFeatureResponse,
} from './get-feed.feature'
import { isExpiringMember } from './renewal-segment'
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
        // EXPIRING announcements only reach members due for renewal. Everyone
        // sees ALL; a member in the segment additionally sees EXPIRING ones.
        const member = await this.prisma.workspaceMember.findFirst({
            where: { workspaceId: f.workspaceId, userId: f.userId },
            select: {
                accessUntil: true,
                subscription: {
                    select: {
                        classesRemaining: true,
                        status: true,
                        startDate: true,
                    },
                },
            },
        })
        const inSegment = member
            ? isExpiringMember({
                  accessUntil: member.accessUntil,
                  classesRemaining:
                      member.subscription?.classesRemaining ?? null,
                  awaitingFirstVisit: isAwaitingFirstVisit(member.subscription),
              })
            : false

        const where = {
            workspaceId: f.workspaceId,
            publishedAt: { lte: new Date() },
            ...(inSegment ? {} : { audience: 'ALL' as const }),
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
