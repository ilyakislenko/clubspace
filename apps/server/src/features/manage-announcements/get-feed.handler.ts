import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadMemberDirectionIds } from '../../domains/directions/direction-scope'
import { isRenewalDue } from '../../domains/subscriptions/renewal-rules'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import {
    STAFF_ROLES,
    type RoleName,
} from '../../shared/decorators/roles.decorator'
import {
    GetAnnouncementFeedFeature,
    GetAnnouncementFeedFeatureResponse,
} from './get-feed.feature'
import { ANNOUNCEMENT_INCLUDE, serializeAnnouncement } from './schemas'
import { loadMemberGroupIds, visibleToMemberWhere } from './target'

// Member-facing feed: published only, pinned first then newest. Any workspace
// member may read it (the WorkspaceMemberGuard on the route is the gate). A
// direction announcement shows only to members of that direction, a group one
// only to the students and coaches of its groups (a guardian reads it acting
// as the child) — the owner and staff see every one.
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
        // EXPIRING announcements («Только на продление») only reach members
        // due for renewal — the «Удержание → Продлить» list (renewal-rules).
        // Everyone sees ALL; a member in the segment additionally sees
        // EXPIRING ones.
        const now = new Date()
        const [member, workspace, inSegment] = await Promise.all([
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                select: { role: { select: { name: true } } },
            }),
            this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: { ownerId: true },
            }),
            isRenewalDue(this.prisma, f.workspaceId, f.userId, now),
        ])
        const isStaff =
            workspace?.ownerId === f.userId ||
            STAFF_ROLES.includes(member?.role?.name as RoleName)
        const visibleWhere: Prisma.AnnouncementWhereInput = isStaff
            ? {}
            : await Promise.all([
                  loadMemberDirectionIds(this.prisma, f.workspaceId, f.userId),
                  loadMemberGroupIds(this.prisma, f.workspaceId, f.userId),
              ]).then(([directionIds, groupIds]) =>
                  visibleToMemberWhere({
                      directionIds: [...directionIds],
                      groupIds,
                  }),
              )

        const where: Prisma.AnnouncementWhereInput = {
            workspaceId: f.workspaceId,
            publishedAt: { lte: now },
            ...(inSegment ? {} : { audience: 'ALL' as const }),
            ...visibleWhere,
        }

        const [rows, total] = await Promise.all([
            this.prisma.announcement.findMany({
                where,
                include: ANNOUNCEMENT_INCLUDE,
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
