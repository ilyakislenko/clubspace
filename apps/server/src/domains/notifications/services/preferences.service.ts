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

// Category-level opt-out flags (in-app/push channel). Adding a category here
// wires it through both getter and updater — keep in sync with the Prisma
// NotificationPreferences columns and the notification-preferences features.
export const NOTIFICATION_CATEGORY_KEYS = [
    'newVideosEnabled',
    'accessExpiringEnabled',
    'promotionsEnabled',
    'announcementsEnabled',
    'inactivityEnabled',
] as const

export type NotificationCategoryKey =
    (typeof NOTIFICATION_CATEGORY_KEYS)[number]

export type NotificationCategoryPreferences = Record<
    NotificationCategoryKey,
    boolean
>

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

    async getCategoryPreferences(
        userId: string,
    ): Promise<NotificationCategoryPreferences> {
        const prefs = await this.getPreferences({ userId })
        return Object.fromEntries(
            NOTIFICATION_CATEGORY_KEYS.map((key) => [key, prefs[key]]),
        ) as NotificationCategoryPreferences
    }

    async updateCategoryPreferences(
        userId: string,
        patch: Partial<NotificationCategoryPreferences>,
    ): Promise<NotificationCategoryPreferences> {
        // Ensure a row exists, then apply only the provided fields.
        await this.getPreferences({ userId })
        const data = Object.fromEntries(
            NOTIFICATION_CATEGORY_KEYS.filter(
                (key) => patch[key] !== undefined,
            ).map((key) => [key, patch[key]]),
        )
        await this.prisma.notificationPreferences.update({
            where: { userId },
            data,
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
