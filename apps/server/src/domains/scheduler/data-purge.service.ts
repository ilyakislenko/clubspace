import { Injectable } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'

const DAY_MS = 24 * 60 * 60_000

// Deleted in id batches so the nightly pass never holds one huge lock; a
// backlog beyond the cap is finished on the following nights.
const NOTIFICATION_BATCH = 5_000
const NOTIFICATION_MAX_BATCHES = 100

// Dispatch-log kinds whose dedupe key only matters inside a bounded window,
// with that window in days (plus slack). Every other kind guards a one-off
// event — an achievement unlocked, a rank promoted, an announcement published
// — and must stay forever, or the next trigger would notify again.
export const DISPATCH_LOG_RETENTION_DAYS: Record<string, number> = {
    'session.reminder': 7,
    'event.reminder': 30,
    'exception.notify': 30,
    'club.daily.run': 7,
    'member.inactive': 30,
    'access.expiring': 30,
    'retention.digest.run': 30,
    'retention.digest': 30,
    'subscription.payment_due': 60,
    'subscription.first_visit_pending': 60,
}

/**
 * Nightly retention for append-only tables: old in-app notifications, dispatch
 * log entries past their dedupe window, and refresh tokens past expiry (a
 * revoked token is kept until then: presenting it is how token reuse is
 * detected).
 */
@Injectable()
export class DataPurgeService {
    constructor(private readonly prisma: PrismaService) {}

    async run(now: Date = new Date()): Promise<{
        notifications: number
        dispatchLog: number
        refreshTokens: number
    }> {
        const notifications = await this.purgeNotifications(
            new Date(
                now.getTime() - environment.notificationRetentionDays * DAY_MS,
            ),
        )

        let dispatchLog = 0
        for (const [kind, days] of Object.entries(DISPATCH_LOG_RETENTION_DAYS)) {
            const { count } = await this.prisma.notificationDispatchLog.deleteMany({
                where: {
                    kind,
                    dispatchedAt: { lt: new Date(now.getTime() - days * DAY_MS) },
                },
            })
            dispatchLog += count
        }

        const { count: refreshTokens } =
            await this.prisma.refreshToken.deleteMany({
                where: { expiresAt: { lt: now } },
            })

        return { notifications, dispatchLog, refreshTokens }
    }

    private async purgeNotifications(cutoff: Date): Promise<number> {
        let total = 0
        for (let i = 0; i < NOTIFICATION_MAX_BATCHES; i += 1) {
            const batch = await this.prisma.notification.findMany({
                where: { createdAt: { lt: cutoff } },
                select: { id: true },
                take: NOTIFICATION_BATCH,
            })
            if (batch.length === 0) break
            const { count } = await this.prisma.notification.deleteMany({
                where: { id: { in: batch.map((n) => n.id) } },
            })
            total += count
            if (batch.length < NOTIFICATION_BATCH) break
        }
        return total
    }
}
