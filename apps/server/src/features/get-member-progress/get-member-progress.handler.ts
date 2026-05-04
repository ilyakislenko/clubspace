import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
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
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, userId }: GetMemberProgressFeature) {
        const [workspace, member, totalVideos] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
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
                },
            }),
            this.prisma.video.count({
                where: { workspaceId, status: 'ready' },
            }),
        ])

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }
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
        ])

        const completedVideoIds = new Set(
            allWatchedRows.filter((r) => r.completed).map((r) => r.videoId),
        )
        const inProgressVideoIds = new Set(
            allWatchedRows
                .filter((r) => !r.completed && r.position > 0)
                .map((r) => r.videoId),
        )

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
                roleName: member.role.name,
                isOwner: member.user.id === workspace.ownerId,
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
        }
    }
}
