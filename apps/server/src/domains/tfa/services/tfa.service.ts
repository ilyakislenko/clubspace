import { Inject, Injectable } from '@nestjs/common'
import { generateSecret } from 'otplib'
import { PrismaService, TfaMethodTypeEnum } from '../../../infrastructure/prisma'
import { encrypt } from '../../../shared/utils/encryption.util'
import type { TfaConfig } from '../configs/tfa-module.config'
import { TFA_CONFIG } from '../configs/tfa-module.config'
@Injectable()
export class TfaService {
    constructor(
        @Inject(TFA_CONFIG)
        private readonly config: TfaConfig,
        private readonly prisma: PrismaService,
    ) {}

    async createTfaMethod(payload: {
        userId: string
        type: TfaMethodTypeEnum
    }) {
        const secret = generateSecret()

        const encryptedSecret = encrypt(secret, this.config.encryptionKey)

        const allRequiredGroups = await this.prisma.tfaRequestGroup.findMany({
            select: {
                id: true,
            },
        })

        await this.prisma.tfaMethod.create({
            data: {
                secret: encryptedSecret,
                userId: payload.userId,
                type: payload.type,
                enabled: true,
                tfaPermissions: {
                    createMany: {
                        data: allRequiredGroups.map((group) => ({
                            groupId: group.id,
                            enabled: true,
                        })),
                    },
                },
            },
        })

        return { secret }
    }

    async disableTfaMethod(payload: { userId: string; methodId: string }) {
        await this.prisma.tfaMethod.update({
            where: { id: payload.methodId, userId: payload.userId },
            data: {
                enabled: false,
            },
        })
    }

    async enableTfaMethod(payload: { userId: string; methodId: string }) {
        await this.prisma.tfaMethod.update({
            where: { id: payload.methodId, userId: payload.userId },
            data: {
                enabled: true,
            },
        })
    }

    async getTfaMethods(payload: { userId: string; onlyEnabled?: boolean }) {
        const methods = await this.prisma.tfaMethod.findMany({
            where: { userId: payload.userId, enabled: payload.onlyEnabled },
            select: {
                id: true,
                type: true,
                enabled: true,
                tfaPermissions: {
                    select: {
                        enabled: true,
                        group: {
                            select: {
                                id: true,
                                key: true,
                                alwaysEnabled: true,
                            },
                        },
                    },
                },
            },
        })

        const allGroups = await this.prisma.tfaRequestGroup.findMany({})

        for (const method of methods) {
            if (method.tfaPermissions.length !== allGroups.length) {
                await this.prisma.tfaPermission.createMany({
                    data: allGroups.map((group) => ({
                        groupId: group.id,
                        methodId: method.id,
                        enabled: true,
                    })),
                    skipDuplicates: true,
                })

                const updatedPermissions =
                    await this.prisma.tfaPermission.findMany({
                        where: { methodId: method.id },
                        select: {
                            enabled: true,
                            group: {
                                select: {
                                    id: true,
                                    key: true,
                                    alwaysEnabled: true,
                                },
                            },
                        },
                    })

                method.tfaPermissions = updatedPermissions
            }
        }

        return methods
    }

    async deleteTfaMethod(payload: { userId: string; methodId: string }) {
        await this.prisma.tfaMethod.delete({
            where: { id: payload.methodId, userId: payload.userId },
        })
    }

    async getTfaRequestGroups() {
        const groups = await this.prisma.tfaRequestGroup.findMany({
            select: {
                id: true,
                key: true,
                alwaysEnabled: true,
            },
        })

        return groups
    }

    async changeTfaMethodPermissions(payload: {
        permissions: {
            userId: string
            methodId: string
            groupId: string
            enabled: boolean
        }[]
    }) {
        for (const permission of payload.permissions) {
            await this.prisma.tfaPermission.update({
                where: {
                    groupId_methodId: {
                        groupId: permission.groupId,
                        methodId: permission.methodId,
                    },
                    method: {
                        userId: permission.userId,
                    },
                },
                data: {
                    enabled: permission.enabled,
                },
            })
        }
    }

    async updateTfaRequestGroups(payload: {
        groups: {
            key: string
            description?: string
            alwaysEnabled: boolean
        }[]
    }) {
        const { groups } = payload

        const existingGroups = await this.prisma.tfaRequestGroup.findMany({})

        const existingGroupsMap = new Map(existingGroups.map((g) => [g.key, g]))

        const newGroups = new Map(groups.map((f) => [f.key, f]))

        const groupsToCreate = groups.filter(
            (g) => !existingGroupsMap.has(g.key),
        )

        const groupsToUpdate = groups.filter((group) => {
            const existing = existingGroupsMap.get(group.key)
            return (
                existing &&
                (existing.description !== group.description ||
                    existing.alwaysEnabled !== group.alwaysEnabled)
            )
        })

        const groupsToDelete = existingGroups.filter(
            (group) => !newGroups.has(group.key),
        )

        if (groupsToCreate.length > 0) {
            await this.prisma.tfaRequestGroup.createMany({
                data: groupsToCreate.map((g) => ({
                    ...g,
                })),
                skipDuplicates: true,
            })
        }

        if (groupsToUpdate.length > 0) {
            for (const group of groupsToUpdate) {
                await this.prisma.tfaRequestGroup.update({
                    where: { key: group.key },
                    data: {
                        description: group.description,
                        alwaysEnabled: group.alwaysEnabled,
                    },
                })
            }
        }

        if (groupsToDelete.length > 0) {
            await this.prisma.tfaRequestGroup.deleteMany({
                where: {
                    key: {
                        in: groupsToDelete.map((g) => g.key),
                    },
                },
            })
        }
    }
}
