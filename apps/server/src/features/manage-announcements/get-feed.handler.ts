import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadMemberDirectionIds } from '../../domains/directions/direction-scope'
import { environment } from '../../environments/environment'
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
import {
    ANNOUNCEMENT_INCLUDE,
    ORG_FEED_SELECT,
    serializeAnnouncement,
    serializeOrgFeedItem,
} from './schemas'
import { loadMemberGroupIds, visibleToMemberWhere } from './target'

// Member-facing feed: published only, pinned first then newest. Any workspace
// member may read it (the WorkspaceMemberGuard on the route is the gate). A
// direction announcement shows only to members of that direction, a group one
// only to the students and coaches of its groups (a guardian reads it acting
// as the child) — the owner and staff see every one.
//
// Federation announcements of the organizations this club is ACTIVE in are
// merged in, tagged with `source`: STAFF_AND_MEMBERS ones for members where
// the club allows them, every one (STAFF included) for the club's staff —
// the place the staff push «От федерации» leads to. Never pinned.
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

        const orgWhere: Prisma.OrganizationAnnouncementWhereInput | null =
            environment.organizations.enabled
                ? {
                      publishedAt: { lte: now },
                      ...(isStaff ? {} : { audience: 'STAFF_AND_MEMBERS' as const }),
                      organization: {
                          isActive: true,
                          clubs: {
                              some: {
                                  workspaceId: f.workspaceId,
                                  status: 'ACTIVE',
                                  ...(isStaff ? {} : { allowMemberAnnouncements: true }),
                              },
                          },
                      },
                  }
                : null
        const skip = (curPage - 1) * perPage

        if (!orgWhere) {
            const [rows, total] = await Promise.all([
                this.prisma.announcement.findMany({
                    where,
                    include: ANNOUNCEMENT_INCLUDE,
                    orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
                    skip,
                    take: perPage,
                }),
                this.prisma.announcement.count({ where }),
            ])
            return { data: rows.map(serializeAnnouncement), total, curPage, perPage }
        }

        // Two sources, one order (pinned first, then newest): each source's
        // first skip+perPage rows are enough to cut the page from.
        const [rows, total, orgRows, orgTotal] = await Promise.all([
            this.prisma.announcement.findMany({
                where,
                include: ANNOUNCEMENT_INCLUDE,
                orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
                take: skip + perPage,
            }),
            this.prisma.announcement.count({ where }),
            this.prisma.organizationAnnouncement.findMany({
                where: orgWhere,
                select: ORG_FEED_SELECT,
                orderBy: { publishedAt: 'desc' },
                take: skip + perPage,
            }),
            this.prisma.organizationAnnouncement.count({ where: orgWhere }),
        ])
        const data = [
            ...rows.map(serializeAnnouncement),
            ...orgRows.map(serializeOrgFeedItem),
        ]
            .sort(
                (a, b) =>
                    Number(b.pinned) - Number(a.pinned) ||
                    (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
            )
            .slice(skip, skip + perPage)
        return { data, total: total + orgTotal, curPage, perPage }
    }
}
