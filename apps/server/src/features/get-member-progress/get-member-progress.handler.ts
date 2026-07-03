import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetMemberProgressFeature,
    GetMemberProgressFeatureResponse,
} from './get-member-progress.feature'

@Feature(GetMemberProgressFeature)
export class GetMemberProgressHandler
    implements
        IFeatureHandler<
            GetMemberProgressFeature,
            GetMemberProgressFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        userId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: GetMemberProgressFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        // Coach scoped to own groups can only inspect students who are in
        // a group they coach. Coach themselves are always allowed (they
        // need to see their own profile). Read-all and admin scopes pass.
        if (ctx.scope === 'coach_own_only' && userId !== invokerUserId) {
            const inOwnGroup = await this.prisma.groupMember.findFirst({
                where: {
                    userId,
                    group: { workspaceId, coachId: invokerUserId },
                },
                select: { groupId: true },
            })
            if (!inOwnGroup) {
                throw new ForbiddenError({
                    message: 'Member is not in any of your groups',
                })
            }
        }
        const [member, totalVideos] = await Promise.all([
            this.prisma.workspaceMember.findFirst({
                where: { workspaceId, userId },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstname: true,
                            lastname: true,
                        },
                    },
                    role: { select: { name: true } },
                    subscription: {
                        select: {
                            id: true,
                            status: true,
                            endDate: true,
                            plan: { select: { name: true } },
                        },
                    },
                },
            }),
            this.prisma.video.count({
                where: { workspaceId, status: 'ready' },
            }),
        ])

        if (!member) {
            throw new NotFoundError({ message: 'Member not found' })
        }

        const [
            completedCount,
            inProgressCount,
            lastWatched,
            allWatchedRows,
            recentRows,
            courses,
            coachOfGroups,
            studentInGroups,
        ] = await Promise.all([
            this.prisma.videoWatched.count({
                where: { workspaceId, userId, completed: true },
            }),
            this.prisma.videoWatched.count({
                where: {
                    workspaceId,
                    userId,
                    completed: false,
                    position: { gt: 0 },
                },
            }),
            this.prisma.videoWatched.findFirst({
                where: { workspaceId, userId },
                orderBy: { watchedAt: 'desc' },
                select: {
                    watchedAt: true,
                    video: { select: { id: true, title: true } },
                },
            }),
            // Per-course progress is computed in memory: pull every progress
            // row for this user once, then bucket by course. Cheaper than
            // running one query per course because most users only have
            // a handful of progress rows.
            this.prisma.videoWatched.findMany({
                where: { workspaceId, userId },
                select: {
                    videoId: true,
                    completed: true,
                    position: true,
                },
            }),
            this.prisma.videoWatched.findMany({
                where: { workspaceId, userId },
                orderBy: { watchedAt: 'desc' },
                take: 20,
                select: {
                    videoId: true,
                    completed: true,
                    position: true,
                    watchedAt: true,
                    video: { select: { title: true } },
                },
            }),
            this.prisma.course.findMany({
                where: { workspaceId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    videos: { select: { videoId: true } },
                },
            }),
            this.prisma.group.findMany({
                where: { workspaceId, coachId: userId },
                select: {
                    id: true,
                    name: true,
                    gym: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.groupMember.findMany({
                where: { userId, group: { workspaceId } },
                select: {
                    group: {
                        select: {
                            id: true,
                            name: true,
                            gym: { select: { id: true, name: true } },
                        },
                    },
                },
            }),
        ])

        const completedVideoIds = new Set(
            allWatchedRows.filter((r) => r.completed).map((r) => r.videoId),
        )
        const inProgressVideoIds = new Set(
            allWatchedRows
                .filter((r) => !r.completed && r.position > 0)
                .map((r) => r.videoId),
        )

        const groupBadges = [
            ...coachOfGroups.map((g) => ({
                id: g.id,
                name: g.name,
                gym: g.gym,
                role: 'coach' as const,
            })),
            ...studentInGroups.map((row) => ({
                id: row.group.id,
                name: row.group.name,
                gym: row.group.gym,
                role: 'student' as const,
            })),
        ]

        const courseProgress = courses.map((course) => {
            let completed = 0
            let inProgress = 0
            for (const v of course.videos) {
                if (completedVideoIds.has(v.videoId)) completed += 1
                else if (inProgressVideoIds.has(v.videoId)) inProgress += 1
            }
            return {
                id: course.id,
                title: course.title,
                slug: course.slug,
                totalVideos: course.videos.length,
                completedCount: completed,
                inProgressCount: inProgress,
            }
        })

        return {
            member: {
                id: member.id,
                userId: member.user.id,
                email: member.user.email,
                firstname: member.user.firstname,
                lastname: member.user.lastname,
                status: member.status,
                roleId: member.roleId,
                roleName: member.role.name,
                isOwner: member.user.id === ctx.workspaceOwnerId,
                accessUntil: member.accessUntil
                    ? member.accessUntil.toISOString()
                    : null,
                createdAt: member.createdAt.toISOString(),
            },
            summary: {
                totalVideos,
                completedCount,
                inProgressCount,
                lastWatchedAt: lastWatched?.watchedAt
                    ? lastWatched.watchedAt.toISOString()
                    : null,
                lastWatchedVideo: lastWatched?.video
                    ? {
                          id: lastWatched.video.id,
                          title: lastWatched.video.title,
                      }
                    : null,
            },
            groups: groupBadges,
            courses: courseProgress,
            recentActivity: recentRows.map((row) => ({
                videoId: row.videoId,
                videoTitle: row.video.title,
                status: row.completed
                    ? ('watched' as const)
                    : ('in-progress' as const),
                position: row.position,
                completed: row.completed,
                watchedAt: row.watchedAt.toISOString(),
            })),
            currentSubscription: member.subscription
                ? {
                      id: member.subscription.id,
                      planName: member.subscription.plan.name,
                      status: member.subscription.status,
                      endDate: member.subscription.endDate
                          ? member.subscription.endDate.toISOString()
                          : null,
                  }
                : null,
        }
    }
}
