import { Injectable } from '@nestjs/common'

import {
    PrismaService,
    PrismaTransactionClientType,
} from '../../../infrastructure/prisma'
import {
    EmailNotSpecifiedError,
    TelegramAccountNotSpecifiedError,
} from '../errors/notifications.errors'
import { ChangePreferences } from '../interfaces/notifications.interfaces'

@Injectable()
export class NotificationsPreferencesService {
    constructor(private readonly prisma: PrismaService) {}

    async getPreferences(payload: { userId: string }) {
        const preferences =
            await this.prisma.notificationPreferences.findUnique({
                where: {
                    userId: payload.userId,
                },
            })

        if (!preferences) {
            return await this.prisma.notificationPreferences.create({
                data: {
                    userId: payload.userId,
                    emailEnabled: false,
                    pushEnabled: false,
                    telegramEnabled: false,
                },
            })
        }

        return preferences
    }

    // ---- Category-level opt-outs (back the mobile Settings toggles) ----

    async getCategoryPreferences(userId: string): Promise<{
        newVideosEnabled: boolean
        accessExpiringEnabled: boolean
    }> {
        const prefs = await this.getPreferences({ userId })
        return {
            newVideosEnabled: prefs.newVideosEnabled,
            accessExpiringEnabled: prefs.accessExpiringEnabled,
        }
    }

    async updateCategoryPreferences(
        userId: string,
        patch: {
            newVideosEnabled?: boolean
            accessExpiringEnabled?: boolean
        },
    ): Promise<{ newVideosEnabled: boolean; accessExpiringEnabled: boolean }> {
        // Ensure a row exists, then apply only the provided fields.
        await this.getPreferences({ userId })
        await this.prisma.notificationPreferences.update({
            where: { userId },
            data: {
                ...(patch.newVideosEnabled !== undefined
                    ? { newVideosEnabled: patch.newVideosEnabled }
                    : {}),
                ...(patch.accessExpiringEnabled !== undefined
                    ? { accessExpiringEnabled: patch.accessExpiringEnabled }
                    : {}),
            },
        })
        return this.getCategoryPreferences(userId)
    }

    async changePreferences(
        data: ChangePreferences,
        prisma?: PrismaTransactionClientType,
    ) {
        const client = prisma || this.prisma

        // force create preferences if not exists
        await this.getPreferences({ userId: data.userId })

        const { userId, email, telegramAccount, ...dataToUpdate } = data

        if (
            data.telegramEnabled === true &&
            (telegramAccount === undefined || telegramAccount === null)
        ) {
            throw new TelegramAccountNotSpecifiedError()
        }

        if (
            data.emailEnabled === true &&
            (email === undefined || email === null)
        ) {
            throw new EmailNotSpecifiedError()
        }

        if (data.telegramEnabled === false) {
            data['telegramAccount'] = null
        }

        if (data.emailEnabled === false) {
            data['email'] = null
        }

        await client.notificationPreferences.update({
            where: {
                userId,
            },
            data: {
                ...dataToUpdate,
            },
        })
    }
}
