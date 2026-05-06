import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceStatsFeature,
    GetWorkspaceStatsFeatureResponse,
} from './get-workspace-stats.feature'

@Feature(GetWorkspaceStatsFeature)
export class GetWorkspaceStatsHandler
    implements
        IFeatureHandler<
            GetWorkspaceStatsFeature,
            GetWorkspaceStatsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: GetWorkspaceStatsFeature) {
        const now = new Date()
        const since7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
        const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // For coach_own_only: pre-compute the visible userId set (own
        // students + coach themselves). Activity stats and top videos
        // get filtered by this set; member count narrows to it; content
        // counts (videos, courses) stay workspace-wide because the
        // content library is shared by design.
        let scopedUserIds: string[] | null = null
        if (ctx.scope === 'coach_own_only') {
            const ownGroups = await this.prisma.group.findMany({
                where: { workspaceId, coachId: invokerUserId },
                select: { members: { select: { userId: true } } },
            })
            const ids = new Set<string>([
                invokerUserId,
                ...ownGroups.flatMap((g) => g.members.map((m) => m.userId)),
            ])
            scopedUserIds = [...ids]
        }

        const userScope =
            scopedUserIds !== null
                ? { userId: { in: scopedUserIds } }
                : {}
        const memberWhere =
            scopedUserIds !== null
                ? { workspaceId, userId: { in: scopedUserIds } }
                : { workspaceId }

        const [videos, videosReady, courses, members, recentEventsRaw] =
            await this.prisma.$transaction([
                this.prisma.video.count({ where: { workspaceId } }),
                this.prisma.video.count({
                    where: { workspaceId, status: 'ready' },
                }),
                this.prisma.course.count({ where: { workspaceId } }),
                this.prisma.workspaceMember.count({ where: memberWhere }),
                this.prisma.auditEvent.findMany({
                    where: { workspaceId },
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                }),
            ])

        const [active7Rows, active30Rows, completions7Total, topVideoRows] =
            await Promise.all([
                this.prisma.videoWatched.findMany({
                    where: {
                        workspaceId,
                        watchedAt: { gte: since7 },
                        ...userScope,
                    },
                    distinct: ['userId'],
                    select: { userId: true },
                }),
                this.prisma.videoWatched.findMany({
                    where: {
                        workspaceId,
                        watchedAt: { gte: since30 },
                        ...userScope,
                    },
                    distinct: ['userId'],
                    select: { userId: true },
                }),
                this.prisma.videoWatched.count({
                    where: {
                        workspaceId,
                        completed: true,
                        watchedAt: { gte: since7 },
                        ...userScope,
                    },
                }),
                // Top videos by distinct viewers in the last 7 days. We pull a
                // bit more than 5 to allow tie-breaking by completion count.
                this.prisma.videoWatched.groupBy({
                    by: ['videoId'],
                    where: {
                        workspaceId,
                        watchedAt: { gte: since7 },
                        ...userScope,
                    },
                    _count: { userId: true },
                    orderBy: { _count: { userId: 'desc' } },
                    take: 8,
                }),
            ])

        const topVideoIds = topVideoRows.map((row) => row.videoId)
        const [topVideoMeta, completionsByVideo] = await Promise.all([
            topVideoIds.length > 0
                ? this.prisma.video.findMany({
                      where: { id: { in: topVideoIds } },
                      select: { id: true, title: true },
                  })
                : [],
            topVideoIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['videoId'],
                      where: {
                          workspaceId,
                          videoId: { in: topVideoIds },
                          completed: true,
                          watchedAt: { gte: since7 },
                          ...userScope,
                      },
                      _count: { _all: true },
                  })
                : [],
        ])

        const titleByVideo = new Map(
            topVideoMeta.map((v) => [v.id, v.title]),
        )
        const completionsByVideoMap = new Map(
            completionsByVideo.map((row) => [row.videoId, row._count._all]),
        )

        const topVideos7d = topVideoRows
            .map((row) => ({
                id: row.videoId,
                title: titleByVideo.get(row.videoId) ?? 'Удалённое видео',
                viewers: row._count.userId,
                completions: completionsByVideoMap.get(row.videoId) ?? 0,
            }))
            .slice(0, 5)

        const actorIds = Array.from(
            new Set(
                recentEventsRaw
                    .map((event) => event.actorId)
                    .filter((id): id is string => Boolean(id)),
            ),
        )

        const actors = actorIds.length
            ? await this.prisma.user.findMany({
                  where: { id: { in: actorIds } },
                  select: { id: true, email: true },
              })
            : []

        const actorEmail = new Map(actors.map((u) => [u.id, u.email]))

        return {
            counts: { videos, videosReady, courses, members },
            activity: {
                activeMembers7d: active7Rows.length,
                activeMembers30d: active30Rows.length,
                completions7d: completions7Total,
            },
            topVideos7d,
            recentEvents: recentEventsRaw.map((event) => ({
                id: event.id,
                action: event.action,
                targetType: event.targetType,
                targetId: event.targetId,
                actorEmail: event.actorId
                    ? actorEmail.get(event.actorId) ?? null
                    : null,
                createdAt: event.createdAt.toISOString(),
            })),
        }
    }
}
