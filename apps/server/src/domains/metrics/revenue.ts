// Club money (glossary B2): what was sold, what recurs, what is owed. Amounts
// stay in the subscription's own integer unit. Money counts PAID rows only
// («Ожидает оплаты» is a receivable, not revenue): every reader goes through
// paidInRangeWhere(), and a row's revenue date is paidOn(). Revenue includes
// the abonements of former members (the sale happened); the receivable does
// not — nobody is chased after leaving the club (awaitingPaymentWhere lives
// with the renewal rules, domains/subscriptions/renewal-rules.ts).

import { localDateInTz, wallClockToUtc } from '../../features/attendance/attendance-utils'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { currentSubscriptionWhere } from '../subscriptions/current-subscriptions'
import { DAY_MS } from '../subscriptions/freeze-dates'

export type SubAmountRow = { amountPaid: number; currency: string }
export type ActiveSubRow = SubAmountRow & {
    startDate: Date | null
    endDate: Date | null
    isPaid: boolean
}
export type DatedSubRow = SubAmountRow & {
    createdAt: Date
    paidAt?: Date | null
}
export type PlanSubRow = SubAmountRow & { planId: string; planName: string }

// The day a sale counts as revenue: when the payment was marked. Rows from
// before payment tracking have no paidAt and fall back to the sale date.
export const paidOn = (r: { paidAt?: Date | null; createdAt: Date }): Date =>
    r.paidAt ?? r.createdAt

// Prisma `where` for «paid in this range» (unbounded = every paid row). Keeps
// the paidAt-or-createdAt fallback in one place.
export const paidInRangeWhere = (range: { gte?: Date; lte?: Date }) => {
    if (range.gte === undefined && range.lte === undefined) {
        return { isPaid: true }
    }
    return {
        isPaid: true,
        OR: [{ paidAt: range }, { paidAt: null, createdAt: range }],
    }
}

// Event tickets (a paid master class) are sales too: staff mark them paid,
// always with paidAt, so the range is on paidAt alone.
export const ticketsPaidInRangeWhere = (range: { gte?: Date; lte?: Date }) => ({
    isPaid: true,
    paidAt: range,
})

export const ticketRevenueSelect = {
    amountPaid: true,
    currency: true,
    paidAt: true,
    createdAt: true,
    eventId: true,
    event: { select: { title: true, currency: true } },
} as const

// A paid ticket as a revenue row: dated by its payment, one breakdown row per
// event (the event stands in for the tariff).
export const ticketRevenueRow = (r: {
    amountPaid: number | null
    currency: string | null
    paidAt: Date | null
    createdAt: Date
    eventId: string
    event: { title: string; currency: string }
}): DatedSubRow & PlanSubRow => ({
    amountPaid: r.amountPaid ?? 0,
    currency: r.currency ?? r.event.currency,
    paidAt: r.paidAt,
    createdAt: r.createdAt,
    planId: r.eventId,
    planName: r.event.title,
})

// The receivable: abonements sold and not paid yet. Counts every row; the
// amount sums the club's dominant currency only, like the other money figures.
export const summarizeAwaiting = (
    rows: SubAmountRow[],
    currency: string | null,
): { count: number; amount: number } => {
    const ccy = currency ?? dominantCurrency(rows)
    return {
        count: rows.length,
        amount: rows
            .filter((r) => r.currency === ccy)
            .reduce((sum, r) => sum + r.amountPaid, 0),
    }
}

// One subscription's contribution to MRR: its paid amount normalised to a
// 30-day month over its own term. Open-ended (no endDate) rows aren't a
// recurring monthly figure, so they contribute 0 — as does one still waiting
// for its first visit (no start yet) and one not paid for yet.
export const monthlyEquivalent = (row: ActiveSubRow): number => {
    if (!row.isPaid || !row.endDate || !row.startDate) return 0
    const days = Math.max(
        1,
        Math.round((row.endDate.getTime() - row.startDate.getTime()) / DAY_MS),
    )
    return Math.round((row.amountPaid * 30) / days)
}

// The most common currency across the rows (ties resolved by first-seen).
export const dominantCurrency = (rows: SubAmountRow[]): string | null => {
    if (rows.length === 0) return null
    const tally = new Map<string, number>()
    for (const r of rows) tally.set(r.currency, (tally.get(r.currency) ?? 0) + 1)
    let best: string | null = null
    let bestCount = 0
    for (const [ccy, count] of tally) {
        if (count > bestCount) {
            best = ccy
            bestCount = count
        }
    }
    return best
}

// Total paid across rows, counting only the dominant currency (mixed-currency
// clubs get one coherent figure). Used for the "today" revenue glance.
export const sumRevenue = (
    rows: SubAmountRow[],
): { amount: number; currency: string | null } => {
    const currency = dominantCurrency(rows)
    const amount = rows
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + r.amountPaid, 0)
    return { amount, currency }
}

export type RevenueSummary = {
    revenue30d: number
    mrr: number
    currency: string | null
}

// The club-local year-month a moment falls in, e.g. "2026-07". A sale at
// 03:00 on the 1st in Томск is that month's revenue, though it is still the
// previous month in UTC.
const monthKey = (d: Date, tz: string): string => localDateInTz(d, tz).slice(0, 7)

// "2026-07" shifted by `delta` months.
export const shiftMonth = (key: string, delta: number): string => {
    const [y, m] = key.split('-').map((p) => parseInt(p, 10))
    const index = y * 12 + (m - 1) + delta
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

// Club-local midnight of the 1st of the oldest month in the trend window —
// the lower bound for the rows the trend is built from.
export const revenueTrendStart = (now: Date, tz: string, months = 6): Date =>
    wallClockToUtc(`${shiftMonth(monthKey(now, tz), -(months - 1))}-01T00:00:00`, tz)

// Revenue per club-local calendar month for the last `months` months (oldest
// first, current month last), summing only the dominant `currency`. Months
// with no sales are emitted with revenue 0 so the chart has a continuous axis.
export const revenueTrend = (
    rows: DatedSubRow[],
    now: Date,
    currency: string | null,
    tz: string,
    months = 6,
): { month: string; revenue: number }[] => {
    const current = monthKey(now, tz)
    const buckets = new Map<string, number>()
    for (let i = months - 1; i >= 0; i--) buckets.set(shiftMonth(current, -i), 0)
    for (const r of rows) {
        if (currency && r.currency !== currency) continue
        const key = monthKey(paidOn(r), tz)
        const prev = buckets.get(key)
        // Ignore anything outside the window (defensive — caller pre-filters).
        if (prev !== undefined) buckets.set(key, prev + r.amountPaid)
    }
    return [...buckets.entries()].map(([month, revenue]) => ({
        month,
        revenue,
    }))
}

export type PlanBreakdownRow = {
    planId: string
    planName: string
    count: number
    revenue: number
}

// Sales grouped by tariff over the rows passed (caller pre-filters to a window),
// dominant currency only, highest-revenue first.
export const revenueByPlan = (
    rows: PlanSubRow[],
    currency: string | null,
): PlanBreakdownRow[] => {
    const acc = new Map<string, PlanBreakdownRow>()
    for (const r of rows) {
        if (currency && r.currency !== currency) continue
        const cur = acc.get(r.planId) ?? {
            planId: r.planId,
            planName: r.planName,
            count: 0,
            revenue: 0,
        }
        cur.count += 1
        cur.revenue += r.amountPaid
        acc.set(r.planId, cur)
    }
    return [...acc.values()].sort((a, b) => b.revenue - a.revenue)
}

// Collapse current + recent rows into the money figures. To keep the number
// coherent for mixed-currency clubs, MRR and revenue30d sum only the dominant
// currency (of the current abonements, else of the sales).
export const computeRevenue = (
    current: ActiveSubRow[],
    recent30: SubAmountRow[],
): RevenueSummary => {
    const currency = dominantCurrency(current) ?? dominantCurrency(recent30)
    const mrr = current
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + monthlyEquivalent(r), 0)
    const revenue30d = recent30
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + r.amountPaid, 0)
    return { revenue30d, mrr, currency }
}

// ---- Loaders: the rows every money figure is computed from ----

// The current abonements behind metric `mrr` («Регулярный доход в месяц»):
// every abonement held now (a member may hold several), whoever holds it;
// `memberWhere` narrows to the holders of a view (the forecast's filters).
export const loadCurrentSales = (
    prisma: PrismaService,
    workspaceId: string,
    now: Date,
    memberWhere?: Prisma.WorkspaceMemberWhereInput,
): Promise<ActiveSubRow[]> =>
    prisma.subscription.findMany({
        where: {
            workspaceId,
            ...currentSubscriptionWhere(now),
            ...(memberWhere ? { workspaceMember: memberWhere } : {}),
        },
        select: { amountPaid: true, currency: true, isPaid: true, startDate: true, endDate: true },
    })

// metric `mrr` on its own (the forecast); the dashboard computes it from the
// same rows with computeRevenue.
export const loadMonthlyRecurringIncome = async (
    prisma: PrismaService,
    workspaceId: string,
    now: Date,
    memberWhere?: Prisma.WorkspaceMemberWhereInput,
): Promise<{ amount: number; currency: string | null }> => {
    const { mrr, currency } = computeRevenue(
        await loadCurrentSales(prisma, workspaceId, now, memberWhere),
        [],
    )
    return { amount: mrr, currency }
}

// Paid sales since `since` — abonements and event tickets, dated by payment —
// behind metrics `revenue_30d`, `revenue_today`, the trend and the breakdown.
export const loadSales = async (
    prisma: PrismaService,
    workspaceId: string,
    since: Date,
): Promise<Array<DatedSubRow & PlanSubRow>> => {
    const [subs, tickets] = await Promise.all([
        prisma.subscription.findMany({
            where: { workspaceId, ...paidInRangeWhere({ gte: since }) },
            select: {
                amountPaid: true,
                currency: true,
                paidAt: true,
                createdAt: true,
                planId: true,
                plan: { select: { name: true } },
            },
        }),
        prisma.eventRegistration.findMany({
            where: { workspaceId, ...ticketsPaidInRangeWhere({ gte: since }) },
            select: ticketRevenueSelect,
        }),
    ])
    return [
        ...subs.map((r) => ({
            amountPaid: r.amountPaid,
            currency: r.currency,
            paidAt: r.paidAt,
            createdAt: r.createdAt,
            planId: r.planId,
            planName: r.plan.name,
        })),
        ...tickets.map(ticketRevenueRow),
    ]
}

// The trailing-30-day window of metric `revenue_30d`.
export const revenueWindowStart = (now: Date): Date => new Date(now.getTime() - 30 * DAY_MS)
