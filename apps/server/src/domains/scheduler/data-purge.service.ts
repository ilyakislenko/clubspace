import { Injectable } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { type Prisma, PrismaService } from '../../infrastructure/prisma'
import {
    anonymizeData,
    idleCloseData,
    idleWhere,
    retentionWhere,
} from '../leads/lead-rules'

const DAY_MS = 24 * 60 * 60_000

// Deleted in id batches so the nightly pass never holds one huge lock; a
// backlog beyond the cap is finished on the following nights.
const NOTIFICATION_BATCH = 5_000
const NOTIFICATION_MAX_BATCHES = 100
const LEAD_BATCH = 1_000
const LEAD_MAX_BATCHES = 100

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
    'review.reminders.run': 7,
    'review.due': 7,
    'subscription.payment_due': 60,
    'subscription.first_visit_pending': 60,
    // Once per agreement and anchor (docs/design/2026-11-15-member-autopay.md
    // §3.6); the other autopay kinds guard one-off events and stay.
    'subscription.autopay_reminder': 60,
    // «Пробные»: the morning reminder is once per club-day; the new-lead and
    // coach heads-up keys name one lead (and one trial time), which never
    // fires again after a month.
    'lead.stale': 7,
    'lead.created': 30,
    'lead.trialBooked': 30,
}

// «Импорт клуба» runs keep the uploaded file's cells (names, e-mails, phones,
// birth dates) for the wizard; a month is plenty to look back at a result.
export const CLUB_IMPORT_RETENTION_DAYS = 30

/**
 * Nightly retention for append-only tables: old in-app notifications, dispatch
 * log entries past their dedupe window, unproven sign-in requests older than a
 * day, refresh tokens past expiry (a
 * revoked token is kept until then: presenting it is how token reuse is
 * detected), club-import runs past CLUB_IMPORT_RETENTION_DAYS, and the
 * personal data of trial requests past their term (purgeLeads).
 */
@Injectable()
export class DataPurgeService {
    constructor(private readonly prisma: PrismaService) {}

    async run(now: Date = new Date()): Promise<{
        notifications: number
        dispatchLog: number
        refreshTokens: number
        pendingSignIns: number
        clubImports: number
        leadsClosed: number
        leadsAnonymized: number
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

        // Unproven sign-in requests: the code is dead after 15 minutes and a
        // lockout after 15 more, so a day-old row holds only an address.
        const { count: pendingSignIns } =
            await this.prisma.pendingSignIn.deleteMany({
                where: { updatedAt: { lt: new Date(now.getTime() - DAY_MS) } },
            })

        const { count: clubImports } = await this.prisma.clubImport.deleteMany({
            where: {
                createdAt: {
                    lt: new Date(now.getTime() - CLUB_IMPORT_RETENTION_DAYS * DAY_MS),
                },
            },
        })

        const { leadsClosed, leadsAnonymized } = await this.purgeLeads(now)

        return {
            notifications,
            dispatchLog,
            refreshTokens,
            pendingSignIns,
            clubImports,
            leadsClosed,
            leadsAnonymized,
        }
    }

    // «Пробные» retention (docs/design/2026-11-26-leads.md §1): idle open
    // leads are closed as LOST NO_ANSWER and anonymised at once, then closed
    // leads past LEAD_CLOSED_RETENTION_DAYS are anonymised. The rows stay for
    // the report; no per-row audit (the journal never held their data).
    async purgeLeads(now: Date): Promise<{ leadsClosed: number; leadsAnonymized: number }> {
        const leadsClosed = await this.inLeadBatches(idleWhere(now), idleCloseData(now))
        const leadsAnonymized = await this.inLeadBatches(retentionWhere(now), anonymizeData(now))
        return { leadsClosed, leadsAnonymized }
    }

    private async inLeadBatches(
        where: Prisma.LeadWhereInput,
        data: Prisma.LeadUpdateManyMutationInput,
    ): Promise<number> {
        let total = 0
        for (let i = 0; i < LEAD_MAX_BATCHES; i += 1) {
            const batch = await this.prisma.lead.findMany({
                where,
                select: { id: true },
                take: LEAD_BATCH,
            })
            if (batch.length === 0) break
            const { count } = await this.prisma.lead.updateMany({
                where: { AND: [where, { id: { in: batch.map((l) => l.id) } }] },
                data,
            })
            total += count
            if (batch.length < LEAD_BATCH) break
        }
        return total
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
