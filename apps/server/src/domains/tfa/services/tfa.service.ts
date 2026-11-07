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

    // Starts (or restarts) setting up an authenticator: a fresh secret on a
    // method that stays disabled until confirmPendingTfaMethod, replacing an
    // earlier unconfirmed one. A confirmed method is left alone.
    async createTfaMethod(payload: {
        userId: string
        type: TfaMethodTypeEnum
    }) {
        const secret = generateSecret()

        const encryptedSecret = encrypt(secret, this.config.encryptionKey)

        await this.prisma.$transaction([
            this.prisma.tfaPermission.deleteMany({
                where: {
                    method: {
                        userId: payload.userId,
                        type: payload.type,
                        enabled: false,
                    },
                },
            }),
            this.prisma.tfaMethod.deleteMany({
                where: {
                    userId: payload.userId,
                    type: payload.type,
                    enabled: false,
                },
            }),
            this.prisma.tfaMethod.create({
                data: {
                    secret: encryptedSecret,
                    userId: payload.userId,
                    type: payload.type,
                    enabled: false,
                },
            }),
        ])

        return { secret }
    }

    // Called once the user proved the pending secret with a code. False when
    // there was nothing pending (never started, or confirmed concurrently).
    async confirmPendingTfaMethod(payload: {
        userId: string
        type: TfaMethodTypeEnum
    }): Promise<boolean> {
        const { count } = await this.prisma.tfaMethod.updateMany({
            where: {
                userId: payload.userId,
                type: payload.type,
                enabled: false,
            },
            data: { enabled: true },
        })
        return count > 0
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
