import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/prisma'
import { toCsv } from '../../shared/utils/csv'

const fullName = (u: { firstname: string | null; lastname: string | null }) =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim()

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
            m.subscription?.plan.name ?? '',
            m.subscription?.classesRemaining ?? '',
            m.subscription?.classesTotal ?? '',
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

    // Revenue: every subscription purchase, newest first — for accounting.
    // Filtered by the purchase (start) date when a range is given.
    async revenueCsv(workspaceId: string, range?: DateRange): Promise<string> {
        const startDate = rangeFilter(range)
        const subs = await this.prisma.subscription.findMany({
            where: {
                workspaceId,
                ...(startDate ? { startDate } : {}),
            },
            select: {
                startDate: true,
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
            orderBy: { startDate: 'desc' },
        })

        const rows = subs.map((s) => {
            const user = s.workspaceMember?.user
            return [
                day(s.startDate),
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
                'Дата',
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
                    select: { classesRemaining: true, classesTotal: true },
                },
            },
            orderBy: { accessUntil: 'asc' },
        })

        const rows = members.flatMap((m) => {
            const remaining = m.subscription?.classesRemaining ?? null
            const lowClasses = remaining != null && remaining <= 1
            const expiring = m.accessUntil != null && m.accessUntil <= soon
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
                    m.subscription?.classesTotal ?? '',
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
