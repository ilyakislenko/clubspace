import { Injectable } from '@nestjs/common'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../domains/subscriptions/current-subscriptions'
import { localDateInTz } from '../attendance/attendance-utils'
import { PrismaService } from '../../infrastructure/prisma'
import { toCsv } from '../../shared/utils/csv'
import {
    paidInRangeWhere,
    paidOn,
    ticketsPaidInRangeWhere,
} from '../get-workspace-stats/revenue'
import {
    renewalNeed,
    renewalSoon,
    renewalSubscriptionSelect,
    renewalSubscriptionsWhere,
} from '../list-renewal-candidates/list-renewal-candidates-utils'

const fullName = (u: { firstname: string | null; lastname: string | null }) =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim()

// Several current abonements share one cell, «; »-joined in the same order
// in every column (null → empty slot, e.g. «8 занятий; Безлимит» / «3; »).
const joinCells = (values: ReadonlyArray<string | number | null>) =>
    values.map((v) => (v === null ? '' : String(v))).join('; ')

const day = (d: Date | null | undefined) =>
    d ? d.toISOString().slice(0, 10) : ''

const TICKET_PAYMENT_LABELS = {
    CASH: 'Наличные',
    TRANSFER: 'Перевод',
    ONLINE: 'Онлайн',
} as const

// Who recorded the abonement sale: staff by hand, or the club's online checkout.
const SUBSCRIPTION_SOURCE_LABELS = {
    MANUAL: 'Вручную',
    GATEWAY: 'Онлайн-оплата',
} as const

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
    // abonements. Ordered oldest-first (join order). One row per member (it's
    // a roster): a member holding several current abonements gets them all in
    // the abonement columns, «; »-joined, ending soonest first — a member with
    // one exports exactly as before.
    async membersCsv(workspaceId: string): Promise<string> {
        const now = new Date()
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
                // Only live abonements (an expired or cancelled one is history).
                subscriptions: {
                    where: currentSubscriptionWhere(now),
                    orderBy: currentSubscriptionOrderBy,
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
            joinCells(m.subscriptions.map((s) => s.plan.name)),
            joinCells(m.subscriptions.map((s) => s.classesRemaining)),
            joinCells(m.subscriptions.map((s) => s.classesTotal)),
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

    // Revenue: every PAID sale, newest payment first — for accounting. The
    // same sales as the dashboard's revenue (revenue.ts): abonements, and the
    // event tickets (a master class) staff marked paid — one row each, the
    // event in the «Тариф / событие» column; unmarking a payment drops its row.
    // Filtered, sorted and printed by the payment date (paidOn: paidAt, or the
    // sale date on rows from before payment tracking); unpaid sales are a
    // receivable, not revenue, and stay out. Sales to members who have since
    // left stay in, under the buyer's name (Subscription.user).
    async revenueCsv(workspaceId: string, range?: DateRange): Promise<string> {
        const paidRange = rangeFilter(range)
        const [workspace, subs, tickets] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { timezone: true },
            }),
            this.prisma.subscription.findMany({
                where: { workspaceId, ...paidInRangeWhere(paidRange ?? {}) },
                select: {
                    createdAt: true,
                    paidAt: true,
                    amountPaid: true,
                    currency: true,
                    source: true,
                    classesTotal: true,
                    plan: { select: { name: true } },
                    user: { select: { firstname: true, lastname: true, email: true } },
                    // Rows sold before Subscription.userId existed.
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
            }),
            this.prisma.eventRegistration.findMany({
                where: { workspaceId, ...ticketsPaidInRangeWhere(paidRange ?? {}) },
                select: {
                    createdAt: true,
                    paidAt: true,
                    amountPaid: true,
                    currency: true,
                    paymentMethod: true,
                    event: { select: { title: true, currency: true } },
                    user: { select: { firstname: true, lastname: true, email: true } },
                },
            }),
        ])

        const rows = [
            ...subs.map((s) => {
                const user = s.user ?? s.workspaceMember?.user
                return {
                    on: paidOn(s),
                    cells: [
                        user ? fullName(user) : '',
                        user?.email ?? '',
                        s.plan.name,
                        s.amountPaid,
                        s.currency,
                        SUBSCRIPTION_SOURCE_LABELS[s.source],
                        s.classesTotal ?? '',
                        'Абонемент',
                        '',
                    ],
                }
            }),
            ...tickets.map((t) => ({
                on: paidOn(t),
                cells: [
                    fullName(t.user),
                    t.user.email ?? '',
                    t.event.title,
                    t.amountPaid ?? 0,
                    t.currency ?? t.event.currency,
                    '',
                    '',
                    'Событие',
                    t.paymentMethod ? TICKET_PAYMENT_LABELS[t.paymentMethod] : '',
                ],
            })),
        ]
        rows.sort((a, b) => b.on.getTime() - a.on.getTime())

        return toCsv(
            [
                'Дата оплаты',
                'Участник',
                'Email',
                'Тариф / событие',
                'Сумма',
                'Валюта',
                'Источник',
                'Занятий в пакете',
                'Вид',
                'Способ оплаты',
            ],
            // The payment day as the club sees it, not the UTC day.
            rows.map((r) => [
                localDateInTz(r.on, workspace?.timezone ?? 'UTC'),
                ...r.cells,
            ]),
        )
    }

    // Outreach list: the same members as the «На продление» screen
    // (list-renewal-candidates-utils: an abonement running out of classes or
    // time, or the access window lapsing, not already renewed with the same
    // scope) — a ready call/message list. The last column names the
    // abonement to renew.
    async renewalsCsv(workspaceId: string): Promise<string> {
        const now = new Date()
        const soon = renewalSoon(now)
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
                subscriptions: {
                    where: renewalSubscriptionsWhere(now),
                    orderBy: currentSubscriptionOrderBy,
                    select: renewalSubscriptionSelect,
                },
            },
            orderBy: { accessUntil: 'asc' },
        })

        const rows = members.flatMap((m) => {
            const need = renewalNeed(m.subscriptions, m.accessUntil, {
                now,
                soon,
            })
            if (!need) return []
            const sub = need.current ? need.subscription : null
            const reason =
                need.reason === 'out_of_classes'
                    ? 'Занятия закончились'
                    : need.reason === 'low_classes'
                      ? 'Осталось 1 занятие'
                      : 'Доступ истекает'
            return [
                [
                    fullName(m.user),
                    m.user.email,
                    reason,
                    sub?.classesRemaining ?? '',
                    sub?.classesTotal ?? '',
                    day(m.accessUntil),
                    need.subscription?.plan.name ?? '',
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
                'Абонемент',
            ],
            rows,
        )
    }
}
