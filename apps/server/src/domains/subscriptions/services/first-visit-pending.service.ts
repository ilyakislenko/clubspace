import { TZDate } from '@date-fns/tz'
import { Injectable, Logger } from '@nestjs/common'

import { MemberStatus, PrismaService } from '../../../infrastructure/prisma'
import { formatRuDate } from '../../../shared/utils/format-ru-date'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import {
    FIRST_VISIT_AUTO_START_DAYS,
    clubDayStart,
    syncFirstVisitStartInTx,
} from '../first-visit-start'
import { DAY_MS } from '../freeze-dates'

// Days after the sale on which a member who has not come yet is reminded.
const REMINDER_DAYS = [3, 10]

// Club-local hours in which the reminder may go out (start inclusive).
const REMINDER_FROM_HOUR = 10
const REMINDER_TO_HOUR = 21

// The two time-driven parts of «срок с первой тренировки», run from the
// scheduler's payments job: the auto-start deadline and the reminders before it.
@Injectable()
export class FirstVisitPendingService {
    private readonly logger = new Logger(FirstVisitPendingService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async run(now: Date = new Date()): Promise<{
        autoStarted: number
        reminded: number
    }> {
        const autoStarted = await this.autoStartOverdue(now)
        const reminded = await this.remindPending(now)
        return { autoStarted, reminded }
    }

    // A pending abonement starts by itself FIRST_VISIT_AUTO_START_DAYS after the
    // sale. The sync is idempotent and decides the exact moment; this only finds
    // the candidates.
    private async autoStartOverdue(now: Date): Promise<number> {
        const overdue = await this.prisma.subscription.findMany({
            where: {
                status: 'ACTIVE',
                startsOnFirstVisit: true,
                startDate: null,
                createdAt: {
                    lte: new Date(
                        now.getTime() - FIRST_VISIT_AUTO_START_DAYS * DAY_MS,
                    ),
                },
            },
            select: {
                workspaceId: true,
                workspaceMember: { select: { userId: true } },
            },
        })

        let count = 0
        for (const s of overdue) {
            const userId = s.workspaceMember?.userId
            if (!userId) continue
            try {
                const res = await this.prisma.$transaction((tx) =>
                    syncFirstVisitStartInTx(tx, {
                        workspaceId: s.workspaceId,
                        userId,
                        now,
                    }),
                )
                if (res === 'started') count += 1
            } catch (err) {
                // One member's lost race must not stop the rest; the next run retries.
                this.logger.error(
                    `first-visit auto-start failed for ${userId}`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
        }
        return count
    }

    private async remindPending(now: Date): Promise<number> {
        const pending = await this.prisma.subscription.findMany({
            where: {
                status: 'ACTIVE',
                startsOnFirstVisit: true,
                startDate: null,
                // Only the last reminder day is of interest; a day of slack
                // covers the club-local day boundary.
                createdAt: {
                    gte: new Date(
                        now.getTime() -
                            (Math.max(...REMINDER_DAYS) + 1) * DAY_MS,
                    ),
                },
                workspaceMember: { is: { status: MemberStatus.ACTIVE } },
            },
            select: {
                id: true,
                workspaceId: true,
                createdAt: true,
                classesTotal: true,
                plan: { select: { name: true } },
                workspace: { select: { timezone: true } },
                workspaceMember: { select: { userId: true } },
            },
        })

        let count = 0
        for (const s of pending) {
            const userId = s.workspaceMember?.userId
            if (!userId) continue
            const tz = s.workspace.timezone
            const hour = new TZDate(now, tz).getHours()
            if (hour < REMINDER_FROM_HOUR || hour >= REMINDER_TO_HOUR) continue

            const saleStart = clubDayStart(s.createdAt, tz)
            const n = Math.round(
                (clubDayStart(now, tz).getTime() - saleStart.getTime()) /
                    DAY_MS,
            )
            if (!REMINDER_DAYS.includes(n)) continue

            const autoStart = new Date(
                saleStart.getTime() + FIRST_VISIT_AUTO_START_DAYS * DAY_MS,
            )
            const sent = await this.notifications.notifyUser({
                userId,
                kind: 'subscription.first_visit_pending',
                refId: `${s.id}:${n}`,
                topic: 'Абонемент ждёт вас',
                message: `Абонемент «${s.plan.name}» начнётся с первой тренировки — приходите! Если не придёте, он начнётся автоматически ${formatRuDate(autoStart, tz)}.`,
                metadata: { subscriptionId: s.id },
                // Rides the «Истечение доступа» preference, like the pack alerts.
                category: 'accessExpiringEnabled',
                workspaceId: s.workspaceId,
                feature: 'subscription',
            })
            if (sent) count += 1
        }
        return count
    }
}
