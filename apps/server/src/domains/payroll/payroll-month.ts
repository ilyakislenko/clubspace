// One payroll month as «Выплаты» shows it: a closed month reads its frozen
// snapshot (plus the drift of today's data from it), an open month is live.

import type { PayrollLine, Prisma } from '../../infrastructure/prisma'
import { localDateInTz } from '../../features/attendance/attendance-utils'
import { computeLivePayroll, type LivePayroll, type PayrollDb } from './payroll-loader'
import {
    monthBounds,
    monthToDbDate,
    type PayrollAdjustmentRow,
    type PayrollLineFact,
    type PayrollRateValues,
} from './payroll-rules'

// An adjustment as a line shows it: `ignored` = in another currency than the
// month's, so not in the amounts.
export type PayrollMonthAdjustment = PayrollAdjustmentRow & { ignored: boolean }

export type PayrollMonthLine = PayrollLineFact & { adjustments: PayrollMonthAdjustment[] }

export type PayrollLineDelta = { coachId: string; name: string; delta: number }

export type PayrollMonthView = {
    month: string
    status: 'open' | 'closed'
    // Open and over in club time.
    canClose: boolean
    closedAt: Date | null
    closedBy: { id: string; name: string } | null
    currency: string
    total: number
    // Closed month: today's total − the frozen one; null only when no coach's
    // total changed (0 when the changes offset). Always null when open.
    drift: number | null
    // Closed month: every coach whose total today differs from the frozen one.
    driftByCoach: PayrollLineDelta[]
    unattributed: { classes: number; revenue: number; otherCurrency: number }
    lines: PayrollMonthLine[]
}

// The club-local month a moment falls in.
export const payrollMonthOf = (now: Date, tz: string): string => localDateInTz(now, tz).slice(0, 7)

// A month may be closed once it is over in club time.
export const hasMonthEnded = (month: string, tz: string, now: Date): boolean =>
    now.getTime() >= monthBounds(month, tz).end.getTime()

const byName = (a: { name: string; coachId: string }, b: { name: string; coachId: string }) =>
    a.name.localeCompare(b.name, 'ru') || a.coachId.localeCompare(b.coachId)

// Per-coach total differences `actual − expected` (a coach missing on one side
// counts as 0 there); empty = the same lines. Drift of a closed month and the
// close guard against what the admin confirmed.
export const lineDeltas = (
    expected: readonly { coachId: string; total: number; name?: string }[],
    actual: readonly { coachId: string; total: number; name?: string }[],
): PayrollLineDelta[] => {
    const rows = new Map<string, PayrollLineDelta>()
    for (const l of expected) rows.set(l.coachId, { coachId: l.coachId, name: l.name ?? '', delta: -l.total })
    for (const l of actual) {
        const row = rows.get(l.coachId) ?? { coachId: l.coachId, name: l.name ?? '', delta: 0 }
        row.delta += l.total
        if (l.name) row.name = l.name
        rows.set(l.coachId, row)
    }
    return [...rows.values()].filter((r) => r.delta !== 0).sort(byName)
}

export const loadClosedPayrollMonth = (db: PayrollDb, workspaceId: string, month: string) =>
    db.payrollMonth.findUnique({
        where: { workspaceId_month: { workspaceId, month: monthToDbDate(month) } },
        include: { lines: true },
    })

// A frozen line in the live line's shape.
export const snapshotLine = (l: PayrollLine): PayrollLineFact => ({
    coachId: l.coachId,
    name: l.coachName,
    // Written by writePayrollSnapshot from PayrollRateValues.
    rate: (l.rate as PayrollRateValues | null) ?? null,
    ignoredRate: null,
    classes: l.classes,
    classesPaid: l.classesPaid,
    marks: l.marks,
    marksPaid: l.marksPaid,
    revenueBase: l.revenueBase,
    amounts: {
        fixed: l.fixedAmount,
        classes: l.classAmount,
        students: l.studentAmount,
        revenue: l.revenueAmount,
        adjustments: l.adjustmentsAmount,
    },
    total: l.total,
})

export const computePayrollMonth = async (
    db: PayrollDb,
    p: { workspaceId: string; month: string; now: Date },
): Promise<PayrollMonthView> => {
    const closed = await loadClosedPayrollMonth(db, p.workspaceId, p.month)
    // The frozen coaches stay staff for the comparison: leaving the club
    // afterwards is not a change of that month's pay.
    const live = await computeLivePayroll(db, {
        workspaceId: p.workspaceId,
        month: p.month,
        alsoStaff: closed?.lines.map((l) => l.coachId),
        currency: closed?.currency,
    })
    const currency = live.currency
    const withAdjustments = (l: PayrollLineFact): PayrollMonthLine => ({
        ...l,
        adjustments: live.adjustments
            .filter((a) => a.coachId === l.coachId)
            .map((a) => ({ ...a, ignored: a.currency !== currency })),
    })
    if (!closed) {
        return {
            month: p.month,
            status: 'open',
            canClose: hasMonthEnded(p.month, live.tz, p.now),
            closedAt: null,
            closedBy: null,
            currency: live.currency,
            total: live.total,
            drift: null,
            driftByCoach: [],
            unattributed: live.unattributed,
            lines: live.lines.map(withAdjustments),
        }
    }
    const lines = closed.lines.map(snapshotLine).sort(byName)
    const driftByCoach = lineDeltas(lines, live.lines)
    return {
        month: p.month,
        status: 'closed',
        canClose: false,
        closedAt: closed.closedAt,
        closedBy: { id: closed.closedById, name: closed.closedByName },
        currency: closed.currency,
        total: closed.total,
        drift: driftByCoach.length > 0 ? live.total - closed.total : null,
        driftByCoach,
        unattributed: {
            classes: closed.unattributedClasses,
            revenue: closed.unattributedRevenue,
            otherCurrency: closed.otherCurrencyRows,
        },
        lines: lines.map(withAdjustments),
    }
}

// Freezes a live month (close, the demo's closed month). The caller holds the
// payroll lock in the same transaction; a second close fails on the
// (workspaceId, month) unique.
export const writePayrollSnapshot = (
    tx: PayrollDb,
    p: {
        workspaceId: string
        live: LivePayroll
        closedBy: { id: string; name: string }
        closedAt: Date
    },
) =>
    tx.payrollMonth.create({
        data: {
            workspaceId: p.workspaceId,
            month: monthToDbDate(p.live.month),
            currency: p.live.currency,
            total: p.live.total,
            unattributedClasses: p.live.unattributed.classes,
            unattributedRevenue: p.live.unattributed.revenue,
            otherCurrencyRows: p.live.unattributed.otherCurrency,
            closedAt: p.closedAt,
            closedById: p.closedBy.id,
            closedByName: p.closedBy.name,
            lines: {
                createMany: {
                    data: p.live.lines.map((l) => ({
                        workspaceId: p.workspaceId,
                        coachId: l.coachId,
                        coachName: l.name,
                        classes: l.classes,
                        classesPaid: l.classesPaid,
                        marks: l.marks,
                        marksPaid: l.marksPaid,
                        revenueBase: l.revenueBase,
                        fixedAmount: l.amounts.fixed,
                        classAmount: l.amounts.classes,
                        studentAmount: l.amounts.students,
                        revenueAmount: l.amounts.revenue,
                        adjustmentsAmount: l.amounts.adjustments,
                        total: l.total,
                        rate: (l.rate ?? undefined) as Prisma.InputJsonValue | undefined,
                    })),
                },
            },
        },
        include: { lines: true },
    })
