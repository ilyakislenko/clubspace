import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import { featureFlagSelect, toFeatureFlags } from '../feature-flags'

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
                role: { select: { name: true } },
                workspace: {
                    select: {
                        id: true,
                        key: true,
                        name: true,
                        type: true,
                        isActive: true,
                        ownerId: true,
                        ...featureFlagSelect,
                    },
                },
            },
            skip: skip,
            take: take,
        })

        const total = await this.prisma.workspaceMember.count({ where })

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
                    features: toFeatureFlags(member.workspace),
                }
            }),
        }
    }
}
