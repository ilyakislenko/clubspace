import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import { appFeatureSelect, toAppFeatureFlags } from '../feature-flags'

@Injectable()
export class WorkspaceService {
    constructor(private readonly prisma: PrismaService) {}

    async getWorkspaces(payload: {
        userId: string
        curPage?: number
        perPage?: number
    }) {
        const { curPage, perPage, skip, take } = parseMetaArgs({
            curPage: payload?.curPage,
            perPage: payload?.perPage,
        })

        // Active memberships only — INVITED goes through the "ожидает
        // одобрения" path, SUSPENDED/BLOCKED shouldn't see the workspace.
        // Access window expiry (accessUntil < now) is surfaced as a flag
        // so the client can route to a dedicated "доступ истёк" screen
        // instead of just blowing up with 403s on every request.
        const where = {
            userId: payload.userId,
            status: 'ACTIVE' as const,
        }
        const workspaceMembers = await this.prisma.workspaceMember.findMany({
            where,
            select: {
                id: true,
                accessUntil: true,
                notificationsMuted: true,
                role: { select: { name: true } },
                workspace: {
                    select: {
                        id: true,
                        key: true,
                        name: true,
                        type: true,
                        isActive: true,
                        ownerId: true,
                        ...appFeatureSelect,
                    },
                },
            },
            skip: skip,
            take: take,
        })

        const total = await this.prisma.workspaceMember.count({ where })

        // Unread in-app notifications per club for the switcher badges. One
        // grouped read over the caller's own unseen rows (indexed on userId).
        const unreadRows = await this.prisma.$queryRaw<
            { workspaceId: string | null; count: bigint }[]
        >`
            SELECT metadata->>'workspaceId' AS "workspaceId", COUNT(*)::bigint AS count
            FROM "Notification"
            WHERE "userId" = ${payload.userId}::uuid AND seen = false AND type = 'PUSH'
            GROUP BY 1
        `
        const unreadByWorkspace = new Map(
            unreadRows.map((r) => [r.workspaceId, Number(r.count)]),
        )

        const now = new Date()
        return {
            meta: {
                curPage,
                perPage,
                total,
            },
            data: workspaceMembers.map((member) => {
                const isOwner = member.workspace.ownerId === payload.userId
                const accessExpired = Boolean(
                    member.accessUntil && member.accessUntil < now && !isOwner,
                )
                return {
                    workspaceId: member.workspace.id,
                    key: member.workspace.key,
                    name: member.workspace.name,
                    type: member.workspace.type,
                    isActive: member.workspace.isActive,
                    accessUntil: member.accessUntil
                        ? member.accessUntil.toISOString()
                        : null,
                    accessExpired,
                    roleName: member.role.name,
                    isOwner,
                    notificationsMuted: member.notificationsMuted,
                    unreadNotifications:
                        unreadByWorkspace.get(member.workspace.id) ?? 0,
                    features: toAppFeatureFlags(member.workspace, now),
                }
            }),
        }
    }
}
