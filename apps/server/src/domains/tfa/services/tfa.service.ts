import { Inject, Injectable } from '@nestjs/common'
import { generateSecret } from 'otplib'
import { Prisma, PrismaService, TfaMethodTypeEnum } from '../../../infrastructure/prisma'
import { encrypt } from '../../../shared/utils/encryption.util'
import type { TfaConfig } from '../configs/tfa-module.config'
import { TFA_CONFIG } from '../configs/tfa-module.config'
import { TfaAlreadyEnabledError } from '../errors/tfa.errors'
import type { TfaCodeMatch } from './tfa-authenticator.service'
@Injectable()
export class TfaService {
    constructor(
        @Inject(TFA_CONFIG)
        private readonly config: TfaConfig,
        private readonly prisma: PrismaService,
    ) {}

    // Starts (or restarts) setting up an authenticator: a fresh secret on the
    // user's one method of this type, which stays disabled until
    // confirmPendingTfaMethod. A confirmed method is never replaced
    // (TfaAlreadyEnabledError).
    async createTfaMethod(payload: {
        userId: string
        type: TfaMethodTypeEnum
    }) {
        const secret = generateSecret()

        const encryptedSecret = encrypt(secret, this.config.encryptionKey)
        const { userId, type } = payload
        const pending = { userId, type, enabled: false }
        const data = { secret: encryptedSecret, lastUsedTimeStep: null }

        try {
            await this.prisma.tfaMethod.upsert({
                where: { userId_type: { userId, type }, enabled: false },
                create: { ...pending, secret: encryptedSecret },
                update: data,
            })
        } catch (error) {
            if (
                !(error instanceof Prisma.PrismaClientKnownRequestError) ||
                error.code !== 'P2002'
            ) {
                throw error
            }
            // The row exists but did not match: either it was confirmed, or a
            // concurrent start created the pending row first (then this one
            // replaces its secret).
            const { count } = await this.prisma.tfaMethod.updateMany({
                where: pending,
                data,
            })
            if (count === 0) throw new TfaAlreadyEnabledError()
        }

        return { secret }
    }

    // Called once the user proved the pending secret with a code: enables
    // exactly the secret that code was checked against. False when it is no
    // longer pending (confirmed concurrently, or a restarted enrolment
    // replaced the secret meanwhile).
    async confirmPendingTfaMethod(payload: {
        userId: string
        match: TfaCodeMatch
    }): Promise<boolean> {
        const { count } = await this.prisma.tfaMethod.updateMany({
            where: {
                id: payload.match.methodId,
                userId: payload.userId,
                secret: payload.match.secret,
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
