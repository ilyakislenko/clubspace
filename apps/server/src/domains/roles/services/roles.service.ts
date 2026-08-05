import { Injectable } from '@nestjs/common'

import { Prisma, PrismaService, PrismaTransactionClientType } from '../../../infrastructure/prisma'
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import { RoleNotFoundError } from '../errors/roles.errors'

@Injectable()
export class RolesService {
    constructor(private readonly prisma: PrismaService) {}

    async createRole(data: { name: string }) {
        return await this.prisma.$transaction(async (tx) => {
            const allFeatures = await tx.roleFeature.findMany({
                select: {
                    id: true,
                },
            })

            const role = await tx.role.create({
                data: {
                    name: data.name.toLowerCase(),
                    editable: true,
                    superuser: false,
                    permissions: {
                        createMany: {
                            data: allFeatures.map((feature) => ({
                                allowed: false,
                                featureId: feature.id,
                            })),
                        },
                    },
                },
                include: {
                    permissions: {
                        include: {
                            feature: true,
                        },
                    },
                },
            })

            return {
                id: role.id,
                name: role.name,
                superuser: role.superuser,
                editable: role.editable,
                features: role.permissions.map((u) => {
                    const allowed =
                        role.superuser === true
                            ? true
                            : u.feature.alwaysIn === null
                            ? u.allowed
                            : u.feature.alwaysIn

                    return {
                        id: u.feature.id,
                        key: u.feature.key,
                        editable: u.feature.alwaysIn === null,
                        group: u.feature.group,
                        description: u.feature.description,
                        allowed,
                    }
                }),
            }
        })
    }

    async updateRole(data: {
        roleId: string
        name?: string
        superuser?: boolean
        editable?: boolean
    }) {
        const { roleId, ...updateData } = data

        return await this.prisma.$transaction(async (tx) => {
            const role = await tx.role.update({
                where: {
                    id: roleId,
                    editable: true,
                },
                data: {
                    ...updateData,
                    name: updateData.name
                        ? updateData.name.toLowerCase()
                        : undefined,
                },
            })

            return role
        })
    }

    /**
     * The role a club owner gets when they hold no WorkspaceMember row.
     *
     * Ownership is `Workspace.ownerId`; a membership row is a separate thing
     * that some creation paths add and others don't. Returns null when the
     * user does not own the club, so the caller can fall through to its normal
     * refusal instead of this becoming a way in.
     *
     * Deliberately resolves the real `admin` role rather than fabricating a
     * permission set — an owner then has exactly a workspace admin's rights,
     * and there is no second definition of those rights to drift.
     */
    async getRoleForWorkspaceOwner(data: {
        userId: string
        workspaceId: string
    }) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: data.workspaceId },
            select: { ownerId: true },
        })

        if (!workspace || workspace.ownerId !== data.userId) {
            return null
        }

        const role = await this.prisma.role.findUnique({
            where: { name: 'admin' },
            include: {
                permissions: { include: { feature: true } },
            },
        })

        if (!role) {
            return null
        }

        return {
            id: role.id,
            name: role.name,
            superuser: role.superuser,
            editable: role.editable,
            features: role.permissions.map((u) => ({
                id: u.feature.id,
                key: u.feature.key,
                editable: u.feature.alwaysIn === null,
                group: u.feature.group,
                description: u.feature.description,
                allowed:
                    role.superuser === true
                        ? true
                        : u.feature.alwaysIn === null
                          ? u.allowed
                          : u.feature.alwaysIn,
            })),
        }
    }

    async getOwnerRole() {
        const role = await this.prisma.role.findFirst({
            where: {
                superuser: true,
            },
        })

        if (!role) {
            throw new RoleNotFoundError({ id: 'owner' })
        }

        return role
    }

    async deleteRole(payload: { roleId: string }) {
        const { roleId } = payload

        const role = await this.prisma.role.delete({
            where: {
                id: roleId,
                editable: true,
            },
        })

        return role
    }

async getRole(data: { 
    userId: string;
    workspaceId: string;
}) {
    const { userId, workspaceId } = data;

    const member = await this.prisma.workspaceMember.findUnique({
        where: {
            userId_workspaceId: {
                userId,
                workspaceId,
            },
        },
        include: {
            role: {
                include: {
                    permissions: {
                        include: {
                            feature: true,
                        },
                    },
                },
            },
        },
    });

    if (!member) {
        throw new RoleNotFoundError({ id: 'User not a member of this workspace' });
    }

    const role = member.role;

    return {
        id: role.id,
        name: role.name,
        superuser: role.superuser,
        editable: role.editable,
        features: role.permissions.map((u) => {
            const allowed =
                role.superuser === true
                    ? true
                    : u.feature.alwaysIn === null
                    ? u.allowed
                    : u.feature.alwaysIn;

            return {
                id: u.feature.id,
                key: u.feature.key,
                editable: u.feature.alwaysIn === null,
                group: u.feature.group,
                description: u.feature.description,
                allowed,
            };
        }),
    };
}


    async getRoles(data: {
        curPage?: number
        perPage?: number
        filter?: {
            name?: string
        }
    }) {
        const { filter } = data

        const { skip, take, curPage, perPage } = parseMetaArgs({
            curPage: data.curPage,
            perPage: data.perPage,
            defaults: {
                curPage: 1,
                perPage: 20,
            },
        })

        const queryOptions: {
            where: Prisma.RoleWhereInput
            orderBy?: Prisma.RoleOrderByWithRelationInput
        } = {
            where: {
                name: undefined,
            },
            orderBy: undefined,
        }

        if (filter?.name) {
            queryOptions.where['name'] = { contains: filter.name }
        }

        const roles = await this.prisma.role.findMany({
            ...queryOptions,
            skip,
            take,
            include: {
                permissions: {
                    include: {
                        feature: true,
                    },
                },
            },
        })

        const total = await this.prisma.role.count({
            ...queryOptions,
        })

        return {
            meta: {
                curPage,
                perPage,
                total,
            },
            data: roles.map((v) => ({
                id: v.id,
                name: v.name,
                superuser: v.superuser,
                editable: v.editable,
                features: v.permissions.map((u) => {
                    const allowed =
                        v.superuser === true
                            ? true
                            : u.feature.alwaysIn === null
                            ? u.allowed
                            : u.feature.alwaysIn

                    return {
                        id: u.feature.id,
                        editable: u.feature.alwaysIn === null,
                        key: u.feature.key,
                        group: u.feature.group,
                        description: u.feature.description,
                        allowed,
                    }
                }),
            })),
        }
    }

    async changePermissions(data: {
        roleId: string
        permissions: {
            featureId: string
            allow: boolean
        }[]
    }) {
        const { roleId, permissions } = data

        for (const permission of permissions) {
            await this.prisma.rolePermission.update({
                where: {
                    roleId_featureId: {
                        roleId,
                        featureId: permission.featureId,
                    },
                    feature: {
                        alwaysIn: null,
                    },
                    role: {
                        editable: true,
                    },
                },
                data: {
                    allowed: permission.allow,
                },
            })
        }
    }

    async changeUserRole(
        data: { userId: string; workspaceId: string; roleName: string },
        prisma?: PrismaTransactionClientType,
    ) {
        const { userId, workspaceId, roleName } = data

        const client = prisma || this.prisma

        const role = await client.role.findUnique({
            where: { name: roleName.toLowerCase() },
        })

        if (!role) {
            throw new RoleNotFoundError({ id: roleName })
        }

        await client.workspaceMember.update({
            where: {
                userId_workspaceId: {
                    userId,
                    workspaceId,
                },
            },
            data: {
                roleId: role.id,
            },
        })
    }

    async createDefaultRole(payload: {
        roles: {
            name: string
            editable: boolean
            superuser: boolean
            default?: boolean
            enabledFeatures: string[]
        }[]
        prisma?: PrismaTransactionClientType
    }) {
        const client = payload.prisma || this.prisma

        const allFeatures = await client.roleFeature.findMany({
            select: {
                id: true,
                key: true,
            },
        })

        const createdRoles = []

        for (const role of payload.roles) {
            const upsertedRole = await client.role.upsert({
                where: {
                    name: role.name.toLowerCase(),
                },
                create: {
                    name: role.name.toLowerCase(),
                    editable: role.editable,
                    superuser: role.superuser,
                    permissions: {
                        createMany: {
                            data: allFeatures.map((f) => ({
                                featureId: f.id,
                                allowed: false,
                            })),
                        },
                    },
                },
                update: {},
                include: {
                    permissions: {
                        select: {
                            featureId: true,
                            allowed: true,
                        },
                    },
                },
            })

            createdRoles.push(upsertedRole)

            const enabledFeatureIds = allFeatures.filter((f) => {
                if (role.superuser) {
                    return true
                }

                return role.enabledFeatures.includes(f.key)
            })

            await client.rolePermission.updateMany({
                where: {
                    roleId: upsertedRole.id,
                },
                data: {
                    allowed: false,
                },
            })

            for (const feature of enabledFeatureIds) {
                await client.rolePermission.upsert({
                    where: {
                        roleId_featureId: {
                            roleId: upsertedRole.id,
                            featureId: feature.id,
                        },
                    },
                    create: {
                        roleId: upsertedRole.id,
                        featureId: feature.id,
                        allowed: true,
                    },
                    update: {
                        allowed: true,
                    },
                })
            }
        }

        return createdRoles
    }

    async updateFeatures(payload: {
        features: {
            key: string
            description?: string
            group?: string
            alwaysIn?: boolean
        }[]
        prisma?: PrismaTransactionClientType
    }) {
        const client = payload.prisma || this.prisma

        const { features } = payload

        const existingFeatures = await client.roleFeature.findMany({
            select: {
                id: true,
                key: true,
                description: true,
                group: true,
                alwaysIn: true,
            },
        })

        const existingFeaturesMap = new Map(
            existingFeatures.map((f) => [f.key, f]),
        )

        const newFeaturesMap = new Map(features.map((f) => [f.key, f]))

        const featuresToCreate = features.filter(
            (feature) => !existingFeaturesMap.has(feature.key),
        )

        const featuresToUpdate = features.filter((feature) => {
            const existing = existingFeaturesMap.get(feature.key)
            return (
                existing &&
                (existing.description !== feature.description ||
                    existing.group !== feature.group ||
                    existing.alwaysIn !== feature.alwaysIn)
            )
        })

        const featuresToDelete = existingFeatures.filter(
            (feature) => !newFeaturesMap.has(feature.key),
        )

        if (featuresToCreate.length > 0) {
            await client.roleFeature.createMany({
                data: featuresToCreate.map((f) => ({
                    ...f,
                })),
                skipDuplicates: true,
            })
        }

        if (featuresToUpdate.length > 0) {
            for (const feature of featuresToUpdate) {
                await client.roleFeature.update({
                    where: { key: feature.key },
                    data: {
                        description: feature.description,
                        group: feature.group,
                    },
                })
            }
        }

        if (featuresToDelete.length > 0) {
            await client.roleFeature.deleteMany({
                where: {
                    key: {
                        in: featuresToDelete.map((f) => f.key),
                    },
                },
            })
        }
    }
}
