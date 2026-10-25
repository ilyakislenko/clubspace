import { Injectable } from '@nestjs/common'

import {
    isAwaitingFirstVisit,
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { toCsv } from '../../shared/utils/csv'
import {
    paidInRangeWhere,
    paidOn,
} from '../get-workspace-stats/revenue'

const fullName = (u: { firstname: string | null; lastname: string | null }) =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim()

// WorkspaceMember.subscriptionId keeps pointing at a pack that has expired or
// been cancelled, so a plain read exports a dead abonement as the member's
// current one. Only report one that is actually live.
const liveSub = <T extends { status: string; endDate: Date | null }>(m: {
    subscription: T | null
}): T | null => (isSubscriptionUsable(m.subscription) ? m.subscription : null)

const day = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : ''

// Inclusive date bounds (the controller passes from = start-of-day and
// to = end-of-day). Produces a Prisma filter, or undefined when unbounded.
export type DateRange = { from?: Date; to?: Date }

const rangeFilter = (range?: DateRange) => {
    if (!range?.from && !range?.to) return undefined
    return {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
    }
}

@Injectable()
export class ExportService {
    constructor(private readonly prisma: PrismaService) {}

    // Roster: every member, contacts, role/status, access window and current
    // pack. Ordered oldest-first (join order).
    async membersCsv(workspaceId: string): Promise<string> {
        const members = await this.prisma.workspaceMember.findMany({
            where: { workspaceId },
            select: {
                status: true,
                accessUntil: true,
                createdAt: true,
                user: {
                    select: {
                        firstname: true,
                        lastname: true,
                        email: true,
                    },
                },
                role: { select: { name: true } },
                subscription: {
                    select: {
                        classesRemaining: true,
                        classesTotal: true,
                        plan: { select: { name: true } },
                        ...subscriptionUsabilitySelect,
                    },
                },
            },
            orderBy: { createdAt: 'asc' },
        })

        const rows = members.map((m) => [
            fullName(m.user),
            m.user.email,
            m.role.name,
            m.status,
            day(m.accessUntil),
            // An expired/cancelled pack must not be exported as the member's
            // current abonement — the pointer outlives the row.
            liveSub(m)?.plan.name ?? '',
            liveSub(m)?.classesRemaining ?? '',
            liveSub(m)?.classesTotal ?? '',
            day(m.createdAt),
        ])

        return toCsv(
            [
                'Имя',
                'Email',
                'Роль',
                'Статус',
                'Доступ до',
                'Абонемент',
                'Занятий осталось',
                'Занятий всего',
                'С нами с',
            ],
            rows,
        )
    }

    // Attendance: every check-in, newest first — session, group and member.
    // Filtered by the session's date when a range is given.
    async attendanceCsv(
        workspaceId: string,
        range?: DateRange,
    ): Promise<string> {
        const startAt = rangeFilter(range)
        const records = await this.prisma.attendanceRecord.findMany({
            where: {
                workspaceId,
                ...(startAt ? { session: { startAt } } : {}),
            },
            select: {
                markedAt: true,
                isGuest: true,
                user: {
                    select: {
                        firstname: true,
                        lastname: true,
                        email: true,
                    },
                },
                session: {
                    select: {
                        title: true,
                        startAt: true,
                        group: { select: { name: true } },
                    },
                },
            },
            orderBy: { markedAt: 'desc' },
        })

        const rows = records.map((r) => [
            day(r.session.startAt),
            r.session.title,
            r.session.group?.name ?? '',
            fullName(r.user),
            r.user.email,
            r.isGuest ? 'да' : '',
        ])

        return toCsv(
            ['Дата', 'Занятие', 'Группа', 'Участник', 'Email', 'Гость'],
            rows,
        )
    }

    // Revenue: every PAID subscription, newest payment first — for accounting.
    // Filtered, sorted and printed by the payment date (paidOn: paidAt, or the
    // sale date on rows from before payment tracking); unpaid sales are a
    // receivable, not revenue, and stay out.
    async revenueCsv(workspaceId: string, range?: DateRange): Promise<string> {
        const paidRange = rangeFilter(range)
        const subs = await this.prisma.subscription.findMany({
            where: { workspaceId, ...paidInRangeWhere(paidRange ?? {}) },
            select: {
                createdAt: true,
                paidAt: true,
                amountPaid: true,
                currency: true,
                source: true,
                classesTotal: true,
                plan: { select: { name: true } },
                workspaceMember: {
                    select: {
                        user: {
                            select: {
                                firstname: true,
                                lastname: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        })
        subs.sort((a, b) => paidOn(b).getTime() - paidOn(a).getTime())

        const rows = subs.map((s) => {
            const user = s.workspaceMember?.user
            return [
                day(paidOn(s)),
                user ? fullName(user) : '',
                user?.email ?? '',
                s.plan.name,
                s.amountPaid,
                s.currency,
                s.source,
                s.classesTotal ?? '',
            ]
        })

        return toCsv(
            [
                'Дата оплаты',
                'Участник',
                'Email',
                'Тариф',
                'Сумма',
                'Валюта',
                'Источник',
                'Занятий в пакете',
            ],
            rows,
        )
    }

    // Outreach list: active members whose access expires within a week or whose
    // class-pack is down to its last visit — a ready call/message list.
    async renewalsCsv(workspaceId: string): Promise<string> {
        const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000)
        const members = await this.prisma.workspaceMember.findMany({
            where: { workspaceId, status: 'ACTIVE' },
            select: {
                accessUntil: true,
                user: {
                    select: {
                        firstname: true,
                        lastname: true,
                        email: true,
                    },
                },
                subscription: {
                    select: {
                        classesRemaining: true,
                        classesTotal: true,
                        startDate: true,
                        ...subscriptionUsabilitySelect,
                    },
                },
            },
            orderBy: { accessUntil: 'asc' },
        })

        const rows = members.flatMap((m) => {
            const remaining = liveSub(m)?.classesRemaining ?? null
            const lowClasses = remaining != null && remaining <= 1
            // A pending abonement's window is provisional — not "expiring".
            const expiring =
                !isAwaitingFirstVisit(m.subscription) &&
                m.accessUntil != null &&
                m.accessUntil <= soon
            if (!lowClasses && !expiring) return []
            const reason =
                remaining === 0
                    ? 'Занятия закончились'
                    : lowClasses
                      ? 'Осталось 1 занятие'
                      : 'Доступ истекает'
            return [
                [
                    fullName(m.user),
                    m.user.email,
                    reason,
                    remaining ?? '',
                    liveSub(m)?.classesTotal ?? '',
                    day(m.accessUntil),
                ],
            ]
        })

        return toCsv(
            [
                'Имя',
                'Email',
                'Причина',
                'Занятий осталось',
                'Занятий всего',
                'Доступ до',
            ],
            rows,
        )
    }
}
