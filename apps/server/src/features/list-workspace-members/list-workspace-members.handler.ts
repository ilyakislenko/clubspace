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
        const [progressRows, workspaceVideoTotal] = await Promise.all([
            userIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['userId'],
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                          completed: true,
                      },
                      _count: { _all: true },
                      _max: { watchedAt: true },
                  })
                : [],
            this.prisma.video.count({
                where: { workspaceId, status: 'ready' },
            }),
        ])
        const progressByUser = new Map(
            progressRows.map((row) => [
                row.userId,
                {
                    watched: row._count._all,
                    last: row._max.watchedAt,
                },
            ]),
        )

        return {
            data: members.map((member) => {
                const stat = progressByUser.get(member.user.id)
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
                    watchedCount: stat?.watched ?? 0,
                    lastWatchedAt: stat?.last
                        ? stat.last.toISOString()
                        : null,
                }
            }),
            total: members.length,
            workspaceVideoTotal,
        }
    }
}
