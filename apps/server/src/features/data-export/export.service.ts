import { Injectable } from '@nestjs/common'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../domains/subscriptions/current-subscriptions'
import { FORMER_STAFF_NAME } from '../../domains/discounts/priced-by'
import { type JournalRow, loadJournalPeople, loadJournalRows } from '../../domains/payments/journal'
import { localDateInTz, localMinuteInTz } from '../attendance/attendance-utils'
import {
    boughtSubscriptionWhere,
    displayStatus,
    LEAD_LOST_REASON_LABELS,
    LEAD_SOURCE_LABELS,
    LEAD_STATUS_LABELS,
} from '../../domains/leads/lead-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import { toCsv } from '../../shared/utils/csv'
import { type DayRange, localDayRange } from '../../shared/utils/local-day-range'
import { PAYMENT_METHOD_LABELS } from '../../shared/utils/payment-method'
import { loadRenewalDue } from '../../domains/subscriptions/renewal-rules'
import { computePayrollMonth, type PayrollMonthLine } from '../../domains/payroll/payroll-month'
import { isAutopayCharge } from '../../domains/payments/journal'
import { resolvePaymentJournalFilter } from '../payment-journal/payment-journal-filter'
import type { PaymentJournalFilter } from '../payment-journal/schemas'

const fullName = (u: { firstname: string | null; lastname: string | null }) =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim()

// Several current abonements share one cell, «; »-joined in the same order
// in every column (null → empty slot, e.g. «8 занятий; Безлимит» / «3; »).
const joinCells = (values: ReadonlyArray<string | number | null>) =>
    values.map((v) => (v === null ? '' : String(v))).join('; ')

// Every date in the files is the club-local day, as the club sees it, not
// the UTC day (a Novosibirsk payment at 04:30 is that day, not the day before).
const day = (d: Date | null | undefined, tz: string) =>
    d ? localDateInTz(d, tz) : ''

// «Семейная», «Разовая» for a one-off only, «Семейная + разовая» for both.
const discountLabel = (r: JournalRow): string => {
    const named = r.discount.named > 0 ? r.discountName : null
    if (named && r.discount.oneOff > 0) return `${named} + разовая`
    if (named) return named
    return r.discount.oneOff > 0 ? 'Разовая' : ''
}

@Injectable()
export class ExportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    private async clubTz(workspaceId: string): Promise<string> {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        })
        return workspace?.timezone ?? 'UTC'
    }

    // Roster: every member, contacts, role/status, access window and current
    // abonements. Ordered oldest-first (join order). One row per member (it's
    // a roster): a member holding several current abonements gets them all in
    // the abonement columns, «; »-joined, ending soonest first — a member with
    // one exports exactly as before.
    async membersCsv(workspaceId: string): Promise<string> {
        const now = new Date()
        const tz = await this.clubTz(workspaceId)
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
            day(m.accessUntil, tz),
            joinCells(m.subscriptions.map((s) => s.plan.name)),
            joinCells(m.subscriptions.map((s) => s.classesRemaining)),
            joinCells(m.subscriptions.map((s) => s.classesTotal)),
            day(m.createdAt, tz),
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
    // Filtered by the session's club-local date when a range is given.
    async attendanceCsv(
        workspaceId: string,
        range?: DayRange,
    ): Promise<string> {
        const tz = await this.clubTz(workspaceId)
        const startAt = localDayRange(range, tz)
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
            day(r.session.startAt, tz),
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

    // The payments journal as a file: every row of the «Платежи» view (same
    // filters, same order: newest payment first), refunds negative from
    // phase B. The same sales as the dashboard's revenue (revenue.ts) —
    // abonements, former members' too, and paid event tickets — with each
    // sale's list price and discount (docs/design/2026-11-15-discounts.md §7).
    async paymentsCsv(
        caller: {
            workspaceId: string
            invokerUserId: string
            roleName: string | null
            isSuperAdmin: boolean
        },
        payload: PaymentJournalFilter,
    ): Promise<{ csv: string; from: string; to: string }> {
        const { filter, from, to, tz } = await resolvePaymentJournalFilter(
            this.prisma,
            this.rbac,
            caller,
            payload,
            new Date(),
        )
        const rows = await loadJournalRows(this.prisma, filter)
        const people = await loadJournalPeople(this.prisma, caller.workspaceId, rows)

        const csv = toCsv(
            [
                'Дата',
                'Вид',
                'Участник',
                'Email',
                'Тариф / событие',
                'Сумма',
                'Цена по тарифу',
                'Скидка',
                'Название скидки',
                'Дал скидку',
                'Валюта',
                'Способ оплаты',
                'Отметил / вернул',
                'Причина возврата',
                'Источник',
                'Занятий в пакете',
                // Last, so the clubs' spreadsheets keep their column positions
                // (docs/design/2026-11-26-parent-pays-for-child.md §3.3).
                'Плательщик',
            ],
            rows.map((r) => [
                day(r.at, tz),
                r.kind === 'refund' ? 'Возврат' : 'Оплата',
                r.person ? fullName(r.person) : '',
                r.person?.email ?? '',
                r.itemName,
                // A refund is money out: negative, so the column sums to the net.
                r.kind === 'refund' ? -r.amount : r.amount,
                r.listPrice ?? '',
                // The total discount, positive; empty without one (and on refunds).
                r.discount.total > 0 ? r.discount.total : '',
                discountLabel(r),
                r.pricedById && r.discount.total > 0
                    ? (people.names.get(r.pricedById) ?? FORMER_STAFF_NAME)
                    : '',
                r.currency,
                // An autopay renewal (docs/design/2026-11-15-member-autopay.md §7).
                r.kind === 'payment' && isAutopayCharge(r.online)
                    ? 'Онлайн (автоплатёж)'
                    : r.method
                      ? PAYMENT_METHOD_LABELS[r.method]
                      : '',
                r.markedById ? (people.names.get(r.markedById) ?? '') : '',
                r.reason ?? '',
                r.source === 'abonement' ? 'Абонемент' : 'Событие',
                r.classesTotal ?? '',
                // The guardian who paid online for a child; empty = the holder.
                r.online?.payerUserId && r.online.payerUserId !== r.userId
                    ? (people.names.get(r.online.payerUserId) ?? '')
                    : '',
            ]),
        )
        return { csv, from, to }
    }

    // «Выплаты» of one month for the accountant
    // (docs/design/2026-11-26-coach-payroll.md §7): the same lines as the page —
    // the frozen snapshot of a closed month, the live figures of an open one —
    // then «Итого» and, when non-zero, «Не распределено».
    async payrollCsv(workspaceId: string, month: string): Promise<string> {
        const view = await computePayrollMonth(this.prisma, {
            workspaceId,
            month,
            now: new Date(),
        })
        const status = view.status === 'closed' ? 'закрыт' : 'предварительно'
        const sum = (pick: (l: PayrollMonthLine) => number) =>
            view.lines.reduce((acc, l) => acc + pick(l), 0)
        const rows: Array<Array<string | number>> = view.lines.map((l) => [
            month,
            status,
            l.name,
            l.classes,
            l.classesPaid,
            l.marks,
            l.revenueBase,
            l.amounts.fixed,
            l.amounts.classes,
            l.amounts.students,
            l.amounts.revenue,
            l.amounts.adjustments,
            l.total,
            view.currency,
        ])
        rows.push([
            month,
            status,
            'Итого',
            sum((l) => l.classes),
            sum((l) => l.classesPaid),
            sum((l) => l.marks),
            sum((l) => l.revenueBase),
            sum((l) => l.amounts.fixed),
            sum((l) => l.amounts.classes),
            sum((l) => l.amounts.students),
            sum((l) => l.amounts.revenue),
            sum((l) => l.amounts.adjustments),
            view.total,
            view.currency,
        ])
        const { classes, revenue, otherCurrency } = view.unattributed
        if (classes !== 0 || revenue !== 0 || otherCurrency !== 0) {
            rows.push([
                month,
                status,
                otherCurrency !== 0
                    ? `Не распределено (оплат в другой валюте: ${otherCurrency})`
                    : 'Не распределено',
                view.unattributed.classes,
                '',
                '',
                view.unattributed.revenue,
                '',
                '',
                '',
                '',
                '',
                '',
                view.currency,
            ])
        }
        return toCsv(
            [
                'Месяц',
                'Статус',
                'Тренер',
                'Занятий',
                'Оплачено занятий',
                'Отметок',
                'Оплаты учеников',
                'Оклад',
                'За занятия',
                'За отметки',
                'Процент',
                'Корректировки',
                'Итого',
                'Валюта',
            ],
            rows,
        )
    }

    // Outreach list: the same members, in the same order, as «Удержание →
    // Продлить» (renewal-rules) — a ready call/message list. The last column
    // names the abonement to renew.
    async renewalsCsv(workspaceId: string): Promise<string> {
        const now = new Date()
        const tz = await this.clubTz(workspaceId)
        const due = await loadRenewalDue(this.prisma, workspaceId, now)

        const rows = due.map(({ user, accessUntil, need }) => {
            const sub = need.current ? need.subscription : null
            const reason =
                need.reason === 'out_of_classes'
                    ? 'Занятия закончились'
                    : need.reason === 'low_classes'
                      ? 'Осталось 1 занятие'
                      : 'Доступ истекает'
            return [
                fullName(user),
                user.email,
                reason,
                sub?.classesRemaining ?? '',
                sub?.classesTotal ?? '',
                day(accessUntil, tz),
                need.subscription?.plan.name ?? '',
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

    // «Пробные» received in the range (docs/design/2026-11-26-leads.md §7),
    // newest first, SPAM included as «Отказ: Спам» but already blank.
    // Anonymised leads keep their row with empty personal columns.
    async leadsCsv(workspaceId: string, range?: DayRange): Promise<string> {
        const tz = await this.clubTz(workspaceId)
        const createdAt = localDayRange(range, tz)
        const leads = await this.prisma.lead.findMany({
            where: { workspaceId, ...(createdAt ? { createdAt } : {}) },
            select: {
                createdAt: true,
                source: true,
                status: true,
                name: true,
                phone: true,
                email: true,
                forChild: true,
                childName: true,
                childAge: true,
                directionName: true,
                trialAt: true,
                trialGroupName: true,
                trialGroup: { select: { gym: { select: { timezone: true } } } },
                lostReason: true,
                comment: true,
                convertedUserId: true,
                convertedUser: { select: { firstname: true, lastname: true } },
            },
            orderBy: { createdAt: 'desc' },
        })
        const linked = [
            ...new Set(leads.flatMap((l) => (l.convertedUserId ? [l.convertedUserId] : []))),
        ]
        const bought = new Set(
            (linked.length
                ? await this.prisma.subscription.findMany({
                      where: { ...boughtSubscriptionWhere(workspaceId), userId: { in: linked } },
                      select: { userId: true },
                      distinct: ['userId'],
                  })
                : []
            ).map((s) => s.userId),
        )
        const rows = leads.map((l) => [
            day(l.createdAt, tz),
            LEAD_SOURCE_LABELS[l.source],
            LEAD_STATUS_LABELS[
                displayStatus(l, l.convertedUserId !== null && bought.has(l.convertedUserId))
            ],
            l.name,
            l.phone,
            l.email,
            l.forChild ? 'да' : '',
            l.childName,
            l.childAge,
            l.directionName,
            // In the zone it was booked in: the trial group's gym, else the club's.
            l.trialAt
                ? localMinuteInTz(l.trialAt, l.trialGroup?.gym?.timezone ?? tz).replace('T', ' ')
                : '',
            l.trialGroupName,
            l.lostReason ? LEAD_LOST_REASON_LABELS[l.lostReason] : '',
            l.comment,
            l.convertedUser ? fullName(l.convertedUser) : '',
        ])
        return toCsv(
            [
                'Получена',
                'Источник',
                'Статус',
                'Имя',
                'Телефон',
                'E-mail',
                'Для ребёнка',
                'Имя ребёнка',
                'Возраст',
                'Направление',
                'Пробное',
                'Группа',
                'Причина отказа',
                'Комментарий',
                'Связан с учеником',
            ],
            rows,
        )
    }
}
