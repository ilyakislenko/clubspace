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
