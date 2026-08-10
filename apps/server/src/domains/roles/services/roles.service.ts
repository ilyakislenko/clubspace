import { Injectable } from '@nestjs/common'

import {
    PrismaService,
    PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import { RoleNotFoundError } from '../errors/roles.errors'

@Injectable()
export class RolesService {
    constructor(private readonly prisma: PrismaService) {}

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

    async getRole(data: { userId: string; workspaceId: string }) {
        const { userId, workspaceId } = data

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
        })

        if (!member) {
            throw new RoleNotFoundError({
                id: 'User not a member of this workspace',
            })
        }

        const role = member.role

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
