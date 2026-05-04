import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersFeatureResponse,
} from './list-workspace-members.feature'

@Feature(ListWorkspaceMembersFeature)
export class ListWorkspaceMembersHandler
    implements
        IFeatureHandler<
            ListWorkspaceMembersFeature,
            ListWorkspaceMembersFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: ListWorkspaceMembersFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        const members = await this.prisma.workspaceMember.findMany({
            // INVITED rows belong to the "ожидают приглашения" panel.
            where: { workspaceId, status: { not: 'INVITED' } },
            orderBy: { createdAt: 'asc' },
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
        })

        // Aggregated progress per member, scoped to this workspace's videos.
        const userIds = members.map((m) => m.user.id)
        const [
            completedRows,
            inProgressRows,
            lastTouches,
            workspaceVideoTotal,
        ] = await Promise.all([
            userIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['userId'],
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                          completed: true,
                      },
                      _count: { _all: true },
                  })
                : [],
            userIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['userId'],
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                          completed: false,
                          position: { gt: 0 },
                      },
                      _count: { _all: true },
                  })
                : [],
            // Latest VideoWatched row per user, with the video title — gives us
            // both the "last activity" timestamp and a concrete signal of what
            // the student is studying right now.
            userIds.length > 0
                ? this.prisma.videoWatched.findMany({
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                      },
                      orderBy: [{ userId: 'asc' }, { watchedAt: 'desc' }],
                      distinct: ['userId'],
                      select: {
                          userId: true,
                          watchedAt: true,
                          video: { select: { id: true, title: true } },
                      },
                  })
                : [],
            this.prisma.video.count({
                where: { workspaceId, status: 'ready' },
            }),
        ])

        const completedByUser = new Map(
            completedRows.map((row) => [row.userId, row._count._all]),
        )
        const inProgressByUser = new Map(
            inProgressRows.map((row) => [row.userId, row._count._all]),
        )
        const lastByUser = new Map(
            lastTouches.map((row) => [row.userId, row]),
        )

        return {
            data: members.map((member) => {
                const last = lastByUser.get(member.user.id)
                return {
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
                    watchedCount: completedByUser.get(member.user.id) ?? 0,
                    inProgressCount: inProgressByUser.get(member.user.id) ?? 0,
                    lastWatchedAt: last?.watchedAt
                        ? last.watchedAt.toISOString()
                        : null,
                    lastWatchedVideo: last?.video
                        ? {
                              id: last.video.id,
                              title: last.video.title,
                          }
                        : null,
                }
            }),
            total: members.length,
            workspaceVideoTotal,
        }
    }
}
