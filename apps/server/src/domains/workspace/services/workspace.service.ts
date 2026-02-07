import { Injectable } from '@nestjs/common'

import {
    Prisma,
    PrismaService,
    PrismaTransactionClientType,
    WorkspaceType,
} from '../../../infrastructure/prisma'
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import { WorkspaceNotFoundError } from '../errors/workspace.errors'

@Injectable()
export class WorkspaceService {
    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async createWorkspace(
        payload: {
            key: string
            name: string
            ownerId: string
            type?: WorkspaceType
            isActive?: boolean
        },
        prisma?: PrismaTransactionClientType,
    ) {
        const client = prisma || this.prisma

        const workspace = await client.workspace.create({
            data: {
                key: payload.key,
                name: payload.name,
                ownerId: payload.ownerId,
                type: payload.type,
                isActive: payload.isActive,
            },
        })

        return workspace
    }

    async setWorkspaceOwner(
        payload: {
            workspaceId: string
            userId: string
        },
        prisma?: PrismaTransactionClientType,
    ) {
        const client = prisma || this.prisma

        await client.workspace.update({
            where: { id: payload.workspaceId },
            data: { ownerId: payload.userId },
        })
    }

    async getLastUsedWorkspace(payload: { userId: string }): Promise<{
        workspaceId: string | undefined
        key: string | undefined
        name: string | undefined
        type: WorkspaceType | undefined
        isActive: boolean | undefined
    }> {
        const workspace = await this.prisma.workspaceMember.findFirst({
            where: { userId: payload.userId },
            select: {
                id: true,
                workspace: {
                    select: {
                        id: true,
                        key: true,
                        name: true,
                        type: true,
                        isActive: true,
                    },
                },
            },
            orderBy: {
                lastSeenAt: 'desc',
            },
        })

        if (!workspace) {
            return {
                workspaceId: undefined,
                key: undefined,
                name: undefined,
                type: undefined,
                isActive: undefined,
            }
        }

        return {
            workspaceId: workspace.workspace.id,
            key: workspace.workspace.key,
            name: workspace.workspace.name,
            type: workspace.workspace.type,
            isActive: workspace.workspace.isActive,
        }
    }

    async getWorkspace(payload: { workspaceId: string; userId: string }) {
        const workspace = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: payload.userId,
                    workspaceId: payload.workspaceId,
                },
            },
            select: {
                id: true,
                workspace: {
                    select: {
                        id: true,
                        key: true,
                        name: true,
                        type: true,
                        isActive: true,
                    },
                },
            },
        })

        if (!workspace) {
            throw new WorkspaceNotFoundError({
                workspaceId: payload.workspaceId,
                userId: payload.userId,
            })
        }

        return {
            workspaceId: workspace.workspace.id,
            key: workspace.workspace.key,
            name: workspace.workspace.name,
            type: workspace.workspace.type,
            isActive: workspace.workspace.isActive,
        }
    }

    async getWorkspaces(payload: {
        userId: string
        curPage?: number
        perPage?: number
    }) {
        const { curPage, perPage, skip, take } = parseMetaArgs({
            curPage: payload?.curPage,
            perPage: payload?.perPage,
        })

        const workspaceMembers = await this.prisma.workspaceMember.findMany({
            where: { userId: payload.userId },
            select: {
                id: true,
                workspace: {
                    select: {
                        id: true,
                        key: true,
                        name: true,
                        type: true,
                        isActive: true,
                    },
                },
            },
            skip: skip,
            take: take,
        })

        const total = await this.prisma.workspaceMember.count({
            where: { userId: payload.userId },
        })

        return {
            meta: {
                curPage,
                perPage,
                total,
            },
            data: workspaceMembers.map((workspace) => ({
                workspaceId: workspace.workspace.id,
                key: workspace.workspace.key,
                name: workspace.workspace.name,
                type: workspace.workspace.type,
                isActive: workspace.workspace.isActive,
            })),
        }
    }

    async updateWorkspace(
        payload: {
            workspaceId: string
            data: Prisma.WorkspaceUpdateInput
        },
        prisma?: PrismaTransactionClientType,
    ) {
        const client = prisma || this.prisma

        await client.workspace.update({
            where: { id: payload.workspaceId },
            data: payload.data,
        })
    }

    async getTotalWorkspacesCount() {
        return await this.prisma.workspace.count()
    }
}
