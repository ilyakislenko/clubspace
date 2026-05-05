import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
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
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: ListWorkspaceMembersFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        // For coaches scoped to own groups: pre-compute the set of student
        // ids visible to them. Coach themselves and the workspace owner
        // stay visible regardless so the list isn't disorienting (they
        // need to see their own row + know who runs the club).
        let scopedUserIds: string[] | null = null
        if (ctx.scope === 'coach_own_only') {
            const ownGroups = await this.prisma.group.findMany({
                where: { workspaceId, coachId: invokerUserId },
                select: { members: { select: { userId: true } } },
            })
            const ids = new Set<string>([
                invokerUserId,
                workspace.ownerId,
                ...ownGroups.flatMap((g) => g.members.map((m) => m.userId)),
            ])
            scopedUserIds = [...ids]
        }

        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId,
                // INVITED rows belong to the "ожидают приглашения" panel.
                status: { not: 'INVITED' },
                ...(scopedUserIds ? { userId: { in: scopedUserIds } } : {}),
            },
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
