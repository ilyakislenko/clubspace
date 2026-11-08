import { z } from 'zod'

import type { PrismaService } from '../../infrastructure/prisma'

export const TelegramStatusOutputSchema = z.object({
    // The server has the bot configured; false → the app hides the row.
    available: z.boolean(),
    linked: z.boolean(),
    // Notifications are mirrored to the chat (NotificationPreferences.telegramEnabled).
    enabled: z.boolean(),
})

export type TelegramStatus = z.infer<typeof TelegramStatusOutputSchema>

export const serializeTelegramStatus = (p: {
    available: boolean
    linked: boolean
    telegramEnabled: boolean | null | undefined
}): TelegramStatus => ({
    available: p.available,
    linked: p.available && p.linked,
    enabled: p.available && p.linked && p.telegramEnabled === true,
})

export const loadTelegramStatus = async (
    prisma: Pick<PrismaService, 'telegramLink' | 'notificationPreferences'>,
    available: boolean,
    userId: string,
): Promise<TelegramStatus> => {
    if (!available) {
        return serializeTelegramStatus({ available, linked: false, telegramEnabled: false })
    }
    const [link, prefs] = await Promise.all([
        prisma.telegramLink.findUnique({ where: { userId }, select: { userId: true } }),
        prisma.notificationPreferences.findUnique({
            where: { userId },
            select: { telegramEnabled: true },
        }),
    ])
    return serializeTelegramStatus({
        available,
        linked: link !== null,
        telegramEnabled: prefs?.telegramEnabled,
    })
}
