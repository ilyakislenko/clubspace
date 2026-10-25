import { Injectable } from '@nestjs/common'

import { localDateInTz } from '../../../features/attendance/attendance-utils'
import { MemberStatus, PrismaService } from '../../../infrastructure/prisma'
import { NotificationProducerService } from '../../notifications/services/notification-producer.service'
import { findMemberCoach } from '../member-coach'
import {
    isReminderHour,
    paymentReminderIndex,
    paymentReminderText,
} from '../payment-reminder'

const KIND = 'subscription.payment_due'

// Time-driven nudges for a running abonement nobody has marked as paid, run
// from the scheduler tick. The member is told whom to ask; the coach's own list
// of unpaid abonements is the actual follow-up.
@Injectable()
export class PaymentReminderService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
    ) {}

    async dispatchDue(now: Date = new Date()): Promise<number> {
        const candidates = await this.prisma.subscription.findMany({
            where: {
                isPaid: false,
                status: 'ACTIVE',
                // A pending (not yet started) abonement has nothing to chase yet.
                startDate: { not: null, lte: now },
                OR: [{ endDate: null }, { endDate: { gt: now } }],
                workspaceMember: { is: { status: MemberStatus.ACTIVE } },
            },
            select: {
                id: true,
                workspaceId: true,
                startDate: true,
                plan: { select: { name: true } },
                workspace: { select: { timezone: true } },
                workspaceMember: { select: { userId: true } },
            },
        })

        const due: {
            sub: (typeof candidates)[number]
            userId: string
            startDate: Date
            refId: string
        }[] = []
        for (const sub of candidates) {
            const userId = sub.workspaceMember?.userId
            if (!userId || !sub.startDate) continue
            const tz = sub.workspace.timezone
            if (!isReminderHour(now, tz)) continue
            const k = paymentReminderIndex(
                localDateInTz(sub.startDate, tz),
                localDateInTz(now, tz),
            )
            if (k === null) continue
            due.push({
                sub,
                userId,
                startDate: sub.startDate,
                refId: `${sub.id}:${k}`,
            })
        }
        if (due.length === 0) return 0

        // Skip what already went out before looking up coaches and visits.
        const logged = await this.prisma.notificationDispatchLog.findMany({
            where: { kind: KIND, refId: { in: due.map((d) => d.refId) } },
            select: { refId: true },
        })
        const sentRefs = new Set(logged.map((l) => l.refId))

        let count = 0
        for (const d of due) {
            if (sentRefs.has(d.refId)) continue
            const { sub, userId } = d
            const [coach, records] = await Promise.all([
                findMemberCoach(this.prisma, {
                    workspaceId: sub.workspaceId,
                    userId,
                }),
                this.prisma.attendanceRecord.findMany({
                    where: {
                        workspaceId: sub.workspaceId,
                        userId,
                        session: { startAt: { gte: d.startDate } },
                    },
                    orderBy: { session: { startAt: 'asc' } },
                    select: { session: { select: { startAt: true } } },
                }),
            ])
            const sent = await this.notifications.notifyUser({
                userId,
                kind: KIND,
                refId: d.refId,
                topic: 'Ожидание оплаты абонемента',
                message: paymentReminderText({
                    planName: sub.plan.name,
                    startDate: d.startDate,
                    timezone: sub.workspace.timezone,
                    coach,
                    visits: records.map((r) => r.session.startAt),
                }),
                metadata: {
                    subscriptionId: sub.id,
                    workspaceId: sub.workspaceId,
                },
                // Rides the «Истечение доступа» preference, like the pack alerts.
                category: 'accessExpiringEnabled',
                workspaceId: sub.workspaceId,
                feature: 'subscription',
            })
            if (sent) count += 1
        }
        return count
    }
}
