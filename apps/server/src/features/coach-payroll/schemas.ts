import { z } from 'zod'

import { FORMER_STAFF_NAME } from '../../domains/discounts/priced-by'
import type { PayrollDb } from '../../domains/payroll/payroll-loader'
import type { PayrollMonthView } from '../../domains/payroll/payroll-month'
import { MONTH_RE } from '../../domains/payroll/payroll-rules'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { displayName } from '../attendance/schemas'

// «Выплаты тренерам» (docs/design/2026-11-26-coach-payroll.md §3.2).

export const MONTH_FORMAT_MESSAGE = 'Месяц в формате ГГГГ-ММ'

export const MonthSchema = z.string().regex(MONTH_RE, MONTH_FORMAT_MESSAGE)

// A month taken from the path (`payroll/:month/close`): the pipe validates
// bodies and queries only.
export const parseMonthParam = (month: string): string => {
    if (!MONTH_RE.test(month)) throw new BadRequestError({ message: MONTH_FORMAT_MESSAGE })
    return month
}

// A rate part in the club's whole currency units.
export const RATE_AMOUNT_MAX = 10_000_000

export const PayrollRateSchema = z.object({
    // The first month it applies to, "2026-11".
    effectiveFrom: z.string(),
    fixedMonthly: z.number().int(),
    perClass: z.number().int(),
    perClassMinStudents: z.number().int(),
    perStudent: z.number().int(),
    // Basis points of the attributed abonement money: 1050 = 10.5 %.
    revenueBp: z.number().int(),
    currency: z.string(),
})

export const PayrollAdjustmentSchema = z.object({
    id: z.string().uuid(),
    amount: z.number().int(),
    // The club's payroll currency when it was added.
    currency: z.string(),
    comment: z.string(),
    createdAt: z.iso.datetime(),
    createdByName: z.string(),
})

export const PayrollAmountsSchema = z.object({
    fixed: z.number().int(),
    classes: z.number().int(),
    students: z.number().int(),
    revenue: z.number().int(),
    adjustments: z.number().int(),
})

export const PayrollLineSchema = z.object({
    coachId: z.string().uuid(),
    name: z.string(),
    // null = «Ставка не задана».
    rate: PayrollRateSchema.nullable(),
    // The rate in force but in another currency than the month's: it pays
    // nothing (never reinterpreted) until a rate in `currency` is set.
    ignoredRate: PayrollRateSchema.nullable(),
    // payroll_classes: counted classes; classesPaid reached the threshold.
    classes: z.number().int(),
    classesPaid: z.number().int(),
    // payroll_marks: marks in counted classes; marksPaid = in paid ones (the
    // per-mark part pays for these).
    marks: z.number().int(),
    marksPaid: z.number().int(),
    // payroll_revenue_base: the coach's share of the month's abonement money.
    revenueBase: z.number().int(),
    amounts: PayrollAmountsSchema,
    total: z.number().int(),
    // `ignored` = in another currency than the month's: not in the amounts.
    adjustments: z.array(PayrollAdjustmentSchema.extend({ ignored: z.boolean() })),
})

export const PayrollMonthOutputSchema = z.object({
    month: z.string(),
    status: z.enum(['open', 'closed']),
    canClose: z.boolean(),
    closedAt: z.iso.datetime().nullable(),
    closedBy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    currency: z.string(),
    total: z.number().int(),
    // Closed month: how much today's data would change the total; null only
    // when no coach's total changed (0 = the changes offset each other).
    drift: z.number().int().nullable(),
    // Closed month: each coach whose total today differs from the frozen one
    // (delta = today − frozen). Always empty for an open month.
    driftByCoach: z.array(
        z.object({ coachId: z.string().uuid(), name: z.string(), delta: z.number().int() }),
    ),
    unattributed: z.object({
        // Counted classes whose coach account is gone.
        classes: z.number().int(),
        // Abonement money with neither visits nor a group to attribute it to.
        revenue: z.number().int(),
        // Sales/refunds in another currency than the club's (a count).
        otherCurrency: z.number().int(),
    }),
    lines: z.array(PayrollLineSchema),
})

export const serializePayrollAdjustment = (a: {
    id: string
    amount: number
    currency: string
    comment: string
    createdAt: Date
    createdByName: string
}): z.infer<typeof PayrollAdjustmentSchema> => ({
    id: a.id,
    amount: a.amount,
    currency: a.currency,
    comment: a.comment,
    createdAt: a.createdAt.toISOString(),
    createdByName: a.createdByName,
})

export const serializePayrollMonth = (
    view: PayrollMonthView,
): z.infer<typeof PayrollMonthOutputSchema> => ({
    month: view.month,
    status: view.status,
    canClose: view.canClose,
    closedAt: view.closedAt ? view.closedAt.toISOString() : null,
    closedBy: view.closedBy,
    currency: view.currency,
    total: view.total,
    drift: view.drift,
    driftByCoach: view.driftByCoach,
    unattributed: view.unattributed,
    lines: view.lines.map((l) => ({
        coachId: l.coachId,
        name: l.name,
        rate: l.rate,
        ignoredRate: l.ignoredRate,
        classes: l.classes,
        classesPaid: l.classesPaid,
        marks: l.marks,
        marksPaid: l.marksPaid,
        revenueBase: l.revenueBase,
        amounts: l.amounts,
        total: l.total,
        adjustments: l.adjustments.map((a) => ({ ...serializePayrollAdjustment(a), ignored: a.ignored })),
    })),
})

// Who did it, as the frozen rows (adjustment author, closer) name them.
export const loadActorName = async (db: PayrollDb, userId: string): Promise<string> => {
    const u = await db.user.findUnique({
        where: { id: userId },
        select: { firstname: true, lastname: true, email: true },
    })
    return u ? displayName(u) : FORMER_STAFF_NAME
}
