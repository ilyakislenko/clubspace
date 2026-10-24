import { Injectable, Logger } from '@nestjs/common'

import {
    NotificationTypeEnum,
    PrismaService,
} from '../../../infrastructure/prisma'
import { ExpoPushClient, ExpoPushMessage } from './expo-push.client'

// Don't keep retrying ancient rows forever: after downtime we don't want to
// suddenly fire a reminder for a session that already happened. Anything older
// than this window is left unsent and ages out of the sweep.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
// Cap work per tick so a backlog can't blow up a single 60s job.
const BATCH_LIMIT = 200

@Injectable()
export class PushDeliveryService {
    private readonly logger = new Logger(PushDeliveryService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly expo: ExpoPushClient,
    ) {}

    /**
     * Delivers every pending PUSH notification: rows written either by the
     * scheduler tick (directly) or by NotificationsService. The existence of
     * the row is the decision to notify; a user only receives anything if they
     * have a registered device token (i.e. granted OS push permission), so the
     * device registry is the de-facto consent gate. Returns the number of rows
     * marked delivered.
     */
    async deliverPending(now: Date = new Date()): Promise<number> {
        const pending = await this.prisma.notification.findMany({
            where: {
                type: NotificationTypeEnum.PUSH,
                sent: false,
                // Only users with a device: rows for web/PWA-only users are
                // never marked sent, and 200 of them at the head of the queue
                // would otherwise starve everyone behind them.
                user: { firebaseDevices: { some: {} } },
                createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) },
            },
            orderBy: { createdAt: 'asc' },
            take: BATCH_LIMIT,
            select: {
                id: true,
                userId: true,
                topic: true,
                message: true,
                link: true,
                metadata: true,
            },
        })

        if (pending.length === 0) return 0

        let delivered = 0
        for (const row of pending) {
            try {
                const sent = await this.deliverOne(row)
                if (sent) delivered += 1
            } catch (err) {
                // Transport hiccup — leave the row unsent and retry next tick.
                this.logger.warn(
                    `Push delivery failed for ${row.id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }

        return delivered
    }

    private async deliverOne(row: {
        id: string
        userId: string
        topic: string
        message: string
        link: string | null
        metadata: unknown
    }): Promise<boolean> {
        const devices = await this.prisma.firebaseDevice.findMany({
            where: { userId: row.userId },
            select: { token: true },
        })

        // No registered device → nothing to deliver to. Leave unsent so a
        // later registration could still pick it up while it's within the age
        // window.
        if (devices.length === 0) return false

        const tokens = devices.map((d) => d.token)
        const messages: ExpoPushMessage[] = tokens.map((token) => ({
            to: token,
            title: row.topic,
            body: row.message,
            data: {
                notificationId: row.id,
                link: row.link ?? undefined,
                ...(typeof row.metadata === 'object' && row.metadata
                    ? (row.metadata as Record<string, unknown>)
                    : {}),
            },
        }))

        const tickets = await this.expo.send(messages)

        const deadTokens: string[] = []
        let anyOk = false
        const errors: string[] = []
        tickets.forEach((ticket, i) => {
            if (ticket.status === 'ok') {
                anyOk = true
                return
            }
            errors.push(ticket.message)
            if (ticket.details?.error === 'DeviceNotRegistered') {
                deadTokens.push(tokens[i])
            }
        })

        if (deadTokens.length > 0) {
            await this.prisma.firebaseDevice.deleteMany({
                where: { userId: row.userId, token: { in: deadTokens } },
            })
        }

        // Mark delivered if at least one device accepted it, OR if every
        // failure was a dead token (retrying is futile — the tokens are gone).
        const allFailuresArePruned =
            errors.length > 0 && deadTokens.length === errors.length

        if (anyOk || allFailuresArePruned) {
            await this.prisma.notification.update({
                where: { id: row.id },
                data: {
                    sent: true,
                    sentAt: new Date(),
                    sentPayload: tickets as never,
                    error: errors.length > 0 ? errors.join('; ') : null,
                },
            })
            return anyOk
        }

        // Transient per-message errors (e.g. Expo rate limit) — record and
        // retry on the next tick.
        await this.prisma.notification.update({
            where: { id: row.id },
            data: { error: errors.join('; ') || 'no tickets returned' },
        })
        return false
    }
}
