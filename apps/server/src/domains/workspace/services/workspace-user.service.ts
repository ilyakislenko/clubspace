import { Injectable } from '@nestjs/common';

import {
    MemberStatus,
    Prisma,
    PrismaService,
    PrismaTransactionClientType,
} from '../../../infrastructure/prisma';
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util';
import { UserNotFoundError } from '../errors/workspace.errors';

@Injectable()
export class WorkspaceUserService {
    constructor(private readonly prisma: PrismaService) {}

    async getUser(payload: { userId: string; workspaceId: string }) {
        const user = await this.prisma.workspaceMember.findUnique({
            where: {
                id: payload.userId,
                workspaceId: payload.workspaceId,
            },
            include: {
                role: {
                    select: {
                        id: true,
                    },
                },
                user: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        })

        if (!user) {
            throw new UserNotFoundError({ id: payload.userId })
        }

        return {
            ...user,
            systemUserId: user.user.id,
            email: user.user.email,
        }
    }

    async getUsers(data: {
        workspaceId: string
        curPage?: number
        perPage?: number
        orderBy?: {
            field: string
            order: 'asc' | 'desc'
        }
        filter?: {
            ids?: string[]
            email?: string
            firstname?: string
            lastname?: string
            role?: string
            status?: MemberStatus
        }
    }) {
        const { filter, orderBy } = data

        const { skip, take, curPage, perPage } = parseMetaArgs({
            curPage: data.curPage,
            perPage: data.perPage,
            defaults: {
                curPage: 1,
                perPage: 20,
            },
        })

        const queryOptions: {
            where: Prisma.WorkspaceMemberWhereInput
            orderBy?: Prisma.WorkspaceMemberOrderByWithRelationInput
        } = {
            where: {
                workspaceId: data.workspaceId,
                user: {},
                id: undefined,
                OR: undefined,
                role: undefined,
                status: undefined,
            },
            orderBy: undefined,
        }

        if (filter?.email) {
            queryOptions.where['user']!['email'] = {
                contains: filter.email,
                mode: 'insensitive',
            }
        }

        if (filter?.ids) {
            queryOptions.where.id = { in: filter.ids }
        }

        if (filter?.firstname) {
            queryOptions.where.OR = [
                {
                    user: {
                        firstname: {
                            contains: filter.firstname,
                            mode: 'insensitive',
                        },
                    },
                },
                { user: { lastname: { contains: filter.firstname, mode: 'insensitive' } } },
            ]
        }

        if (filter?.lastname) {
            queryOptions.where.OR = [
                {
                    user: { firstname: { contains: filter.lastname, mode: 'insensitive' } },
                },
                { user: { lastname: { contains: filter.lastname, mode: 'insensitive' } } },
            ]
        }

        if (filter?.role) {
            queryOptions.where.role = {
                name: filter.role,
            }
        }

        if (filter?.status) {
            queryOptions.where.status = filter.status
        }

        if (orderBy) {
            queryOptions.orderBy = {
                [orderBy.field]: orderBy.order,
            }
        }

        const users = await this.prisma.workspaceMember.findMany({
            ...queryOptions,
            skip,
            take,
            include: {
                role: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                user: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        })

        const total = await this.prisma.workspaceMember.count({
            ...queryOptions,
        })

        return {
            meta: {
                curPage,
                perPage,
                total,
            },
            data: users.map((user) => ({
                ...user,
                systemUserId: user.user.id,
                email: user.user.email,
            })),
        }
    }

    async blockUsers(payload: { userIds: string[]; workspaceId: string }) {
        return await this.prisma.workspaceMember.updateMany({
            where: {
                id: { in: payload.userIds },
                workspaceId: payload.workspaceId,
            },
            data: {
                status: MemberStatus.BLOCKED,
            },
        })
    }

    async blockUser(payload: { userId: string; workspaceId: string }) {
        const user = await this.prisma.workspaceMember.update({
            where: {
                id: payload.userId,
                workspaceId: payload.workspaceId,
            },
            data: {
                status: MemberStatus.BLOCKED,
            },
        })

        return user
    }

    async createUsers(data: {
        users: {
            userId: string
            firstname: string
            lastname: string
        }[]
        workspaceId: string
        roleId: string
    }) {
        const { users, workspaceId, roleId } = data

        for (const user of users) {
            await this.prisma.workspaceMember.create({
                data: {
                    status: MemberStatus.ACTIVE,
                    user: {
                        connect: {
                            id: user.userId,
                        },
                    },
                    workspace: {
                        connect: {
                            id: workspaceId,
                        },
                    },
                    role: {
                        connect: {
                            id: roleId,
                        },
                    },
                },
            })
        }
    }

    async createUser(
        payload: {
            userId: string
            workspaceId: string
            roleId: string
        },
        prisma?: PrismaTransactionClientType,
    ) {
        const client = prisma || this.prisma

        const user = await client.workspaceMember.create({
            data: {
                status: MemberStatus.ACTIVE,
                workspace: {
                    connect: {
                        id: payload.workspaceId,
                    },
                },
                role: {
                    connect: {
                        id: payload.roleId,
                    },
                },
                user: {
                    connect: {
                        id: payload.userId,
                    },
                },
            },
        })

        return { id: user.id }
    }

    async updateUser(data: {
        userId: string
        workspaceId: string
        status?: MemberStatus
        roleId?: string
    }) {
        const {
            userId,
            workspaceId,
            status,
            roleId
        } = data

        const isUserExist = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: userId,
                    workspaceId: workspaceId,
                },
                workspaceId: workspaceId,
            },
            select: {
                status: true,
                role: {
                    select: {
                        name: true,
                    },
                },
            },
        })

        if (!isUserExist) {
            throw new UserNotFoundError({ id: userId })
        }

        const updateData: Prisma.WorkspaceMemberUpdateInput = {}

        if (typeof status !== 'undefined') updateData.status = status

        if (typeof roleId !== 'undefined') updateData.role = {
            connect: {
                id: roleId,
            },
        }

        const user = await this.prisma.workspaceMember.update({
            where: {
                userId_workspaceId: {
                    userId: userId,
                    workspaceId: workspaceId,
                },
            },
            data: updateData,
        })

        return user
    }
}
