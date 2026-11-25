// Reads the rows one payroll month is computed from (payroll-rules.ts decides).
// Money goes through the metrics where-builders only (conventions §1).

import { displayName } from '../../features/attendance/schemas'
import { localDateInTz } from '../../features/attendance/attendance-utils'
import { coachCandidatesWhere } from '../../features/class-substitutions/class-substitution-access'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { FORMER_STAFF_NAME } from '../discounts/priced-by'
import {
    dominantCurrency,
    paidInRangeWhere,
    refundsInRangeWhere,
    shiftMonth,
} from '../metrics/revenue'
import { DAY_MS } from '../subscriptions/freeze-dates'
import {
    attributeRevenue,
    computeLines,
    countedClasses,
    marksBySubscription,
    monthBounds,
    monthToDbDate,
    type PayrollAdjustmentRow,
    type PayrollClass,
    type PayrollLineFact,
    type PayrollRevenueRow,
    type PayrollSessionFact,
} from './payroll-rules'

// A PrismaService or the client of an open transaction.
export type PayrollDb = PrismaTransactionClientType

// The club's payroll currency: its dominant tariff currency, else RUB.
export const loadPayrollCurrency = async (db: PayrollDb, workspaceId: string): Promise<string> => {
    const plans = await db.plan.findMany({ where: { workspaceId }, select: { currency: true } })
    return dominantCurrency(plans.map((p) => ({ amountPaid: 0, currency: p.currency }))) ?? 'RUB'
}

// The month's group sessions (personal, event and groupless ones are left to
// the rule to drop by their kind — the query already skips them). Read over
// the month ± 1 day on [workspaceId, startAt]: sessionDate is slot-local and a
// gym may sit in another zone than the club.
export const loadPayrollSessions = async (
    db: PayrollDb,
    p: { workspaceId: string; month: string; tz: string },
): Promise<PayrollSessionFact[]> => {
    const { start, end } = monthBounds(p.month, p.tz)
    const rows = await db.attendanceSession.findMany({
        where: {
            workspaceId: p.workspaceId,
            startAt: { gte: new Date(start.getTime() - DAY_MS), lt: new Date(end.getTime() + DAY_MS) },
            groupId: { not: null },
            isPersonal: false,
            workspaceEventId: null,
        },
        select: {
            id: true,
            groupId: true,
            slotId: true,
            occurrenceKey: true,
            sessionDate: true,
            startAt: true,
            timezone: true,
            isPersonal: true,
            workspaceEventId: true,
            coachId: true,
            group: { select: { name: true, coachId: true, coaches: { select: { userId: true } } } },
            records: { select: { userId: true, usedSubscriptionId: true } },
        },
    })
    return rows.map((s) => ({
        id: s.id,
        groupId: s.groupId,
        groupName: s.group?.name ?? null,
        groupCoachIds: s.group?.coaches.map((c) => c.userId) ?? [],
        groupPrimaryCoachId: s.group?.coachId ?? null,
        scheduledSlotId:
            s.slotId ??
            (s.occurrenceKey.startsWith('slot:') ? s.occurrenceKey.split(':')[1] : null),
        sessionDate: s.sessionDate
            ? s.sessionDate.toISOString().slice(0, 10)
            : localDateInTz(s.startAt, s.timezone),
        startAt: s.startAt,
        isPersonal: s.isPersonal,
        workspaceEventId: s.workspaceEventId,
        coachId: s.coachId,
        records: s.records,
    }))
}

// The month's classes, tested against the cancellations as they are now.
export const loadPayrollClasses = async (
    db: PayrollDb,
    p: { workspaceId: string; month: string; tz: string },
): Promise<{ counted: PayrollClass[]; cancelled: PayrollClass[] }> => {
    const sessions = await loadPayrollSessions(db, p)
    const groupIds = [...new Set(sessions.flatMap((s) => (s.groupId ? [s.groupId] : [])))]
    const exceptions =
        groupIds.length > 0
            ? await db.scheduleException.findMany({
                  where: {
                      groupId: { in: groupIds },
                      fromDate: { lt: monthToDbDate(shiftMonth(p.month, 1)) },
                      untilDate: { gte: monthToDbDate(p.month) },
                  },
                  select: { groupId: true, slotId: true, fromDate: true, untilDate: true },
              })
            : []
    return countedClasses(p.month, sessions, exceptions)
}

// Who counts as staff for a month's rate-only rows: today's staff (the owner
// and active coaching members, whenever they joined — a rate set for a month
// before the membership began, e.g. for staff imported later, is meant), and
// anyone removed, gone or demoted to a student since the month began (they
// were staff in it). Someone who left before the month began is not: a
// departed coach's pay stops with the month they left. computeLines still
// asks for a rate in force. Membership rows are deleted on removal, so the
// club's journal tells when someone left.
export const loadPayrollStaff = async (
    db: PayrollDb,
    p: { workspaceId: string; ownerId: string; start: Date },
): Promise<Set<string>> => {
    const [current, left] = await Promise.all([
        db.user.findMany({
            where: coachCandidatesWhere(p.workspaceId, p.ownerId),
            select: { id: true },
        }),
        db.auditEvent.findMany({
            where: {
                workspaceId: p.workspaceId,
                OR: [
                    { action: { in: ['member.remove', 'member.leave'] } },
                    { action: 'member.updateRole', metadata: { path: ['toRoleName'], equals: 'user' } },
                ],
                targetType: 'member',
                createdAt: { gte: p.start },
            },
            select: { targetId: true },
        }),
    ])
    return new Set([
        ...current.map((u) => u.id),
        ...left.flatMap((e) => (e.targetId ? [e.targetId] : [])),
    ])
}

// Abonement sales paid in the month (+) and refunds of abonement sales made
// in it (−); tickets are not a coach's money.
const loadRevenueRows = async (
    db: PayrollDb,
    p: { workspaceId: string; start: Date; end: Date },
): Promise<PayrollRevenueRow[]> => {
    // The where-builders take an inclusive range; the month's end is exclusive.
    const range = { gte: p.start, lte: new Date(p.end.getTime() - 1) }
    const [sales, refunds] = await Promise.all([
        db.subscription.findMany({
            where: { workspaceId: p.workspaceId, ...paidInRangeWhere(range) },
            select: { id: true, userId: true, amountPaid: true, currency: true },
        }),
        db.refund.findMany({
            where: {
                workspaceId: p.workspaceId,
                ...refundsInRangeWhere(range),
                subscriptionId: { not: null },
            },
            select: {
                subscriptionId: true,
                userId: true,
                amount: true,
                currency: true,
                subscription: { select: { userId: true } },
            },
        }),
    ])
    return [
        ...sales.map((s) => ({
            subscriptionId: s.id,
            userId: s.userId,
            amount: s.amountPaid,
            currency: s.currency,
        })),
        ...refunds.map((r) => ({
            subscriptionId: r.subscriptionId as string,
            userId: r.subscription?.userId ?? r.userId,
            amount: -r.amount,
            currency: r.currency,
        })),
    ]
}

export type LivePayroll = {
    month: string
    tz: string
    currency: string
    lines: PayrollLineFact[]
    adjustments: PayrollAdjustmentRow[]
    counted: PayrollClass[]
    cancelled: PayrollClass[]
    unattributed: { classes: number; revenue: number; otherCurrency: number }
    total: number
    names: Map<string, string>
}

// The month computed from today's data (an open month; the drift of a closed
// one). `alsoStaff`: people who count as staff regardless (a closed month's
// frozen coaches, so a later departure is not drift); `currency`: the closed
// month's frozen currency (else the club's today).
export const computeLivePayroll = async (
    db: PayrollDb,
    p: { workspaceId: string; month: string; alsoStaff?: readonly string[]; currency?: string },
): Promise<LivePayroll> => {
    const workspace = await db.workspace.findUnique({
        where: { id: p.workspaceId },
        select: { timezone: true, ownerId: true },
    })
    if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
    const tz = workspace.timezone
    const { start, end } = monthBounds(p.month, tz)
    const first = monthToDbDate(p.month)

    const [classes, revenueRows, rates, adjustments, staff, currency] = await Promise.all([
        loadPayrollClasses(db, { workspaceId: p.workspaceId, month: p.month, tz }),
        loadRevenueRows(db, { workspaceId: p.workspaceId, start, end }),
        db.coachRate.findMany({
            where: { workspaceId: p.workspaceId, effectiveFrom: { lte: first } },
            select: {
                coachId: true,
                effectiveFrom: true,
                fixedMonthly: true,
                perClass: true,
                perClassMinStudents: true,
                perStudent: true,
                revenueBp: true,
                currency: true,
            },
        }),
        db.payrollAdjustment.findMany({
            where: { workspaceId: p.workspaceId, month: first },
            select: {
                id: true,
                coachId: true,
                amount: true,
                currency: true,
                comment: true,
                createdAt: true,
                createdByName: true,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        loadPayrollStaff(db, { workspaceId: p.workspaceId, ownerId: workspace.ownerId, start }),
        p.currency ?? loadPayrollCurrency(db, p.workspaceId),
    ])

    const holderIds = [...new Set(revenueRows.flatMap((r) => (r.userId ? [r.userId] : [])))]
    const rosterRows =
        holderIds.length > 0
            ? await db.groupMember.findMany({
                  where: { userId: { in: holderIds }, group: { workspaceId: p.workspaceId } },
                  select: { userId: true, group: { select: { coachId: true } } },
              })
            : []
    const roster = new Map<string, string[]>()
    for (const r of rosterRows) roster.set(r.userId, [...(roster.get(r.userId) ?? []), r.group.coachId])

    const attribution = attributeRevenue(
        revenueRows,
        marksBySubscription(classes.counted),
        roster,
        currency,
    )

    const staffIds = new Set([...staff, ...(p.alsoStaff ?? [])])
    const personIds = new Set<string>([
        ...classes.counted.flatMap((c) => (c.coachId ? [c.coachId] : [])),
        ...classes.cancelled.flatMap((c) => (c.coachId ? [c.coachId] : [])),
        ...rates.map((r) => r.coachId),
        ...adjustments.map((a) => a.coachId),
        ...staffIds,
    ])
    const people = await db.user.findMany({
        where: { id: { in: [...personIds] } },
        select: { id: true, firstname: true, lastname: true, email: true },
    })
    const names = new Map(people.map((u) => [u.id, displayName(u)]))

    const lines = computeLines({
        month: p.month,
        currency,
        classes: classes.counted,
        rates,
        adjustments,
        revenueByCoach: attribution.byCoach,
        staffIds,
        names,
        fallbackName: FORMER_STAFF_NAME,
    })
    return {
        month: p.month,
        tz,
        currency,
        lines,
        adjustments,
        counted: classes.counted,
        cancelled: classes.cancelled,
        unattributed: {
            classes: classes.counted.filter((c) => !c.coachId).length,
            revenue: attribution.unattributed,
            otherCurrency: attribution.otherCurrency,
        },
        total: lines.reduce((sum, l) => sum + l.total, 0),
        names,
    }
}
