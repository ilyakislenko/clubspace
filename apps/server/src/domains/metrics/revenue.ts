// Club money (glossary B2): what was sold, what recurs, what is owed. Amounts
// stay in the subscription's own integer unit. Money counts PAID rows only
// («Ожидает оплаты» is a receivable, not revenue): every reader goes through
// paidInRangeWhere(), and a row's revenue date is paidOn(). Revenue includes
// the abonements of former members (the sale happened); the receivable does
// not — nobody is chased after leaving the club (awaitingPaymentWhere lives
// with the renewal rules, domains/subscriptions/renewal-rules.ts).
// Revenue is net of refunds (docs/design/2026-11-15-payments-journal.md §1):
// a refund of a sale lowers the revenue of the window it happened in
// (refundsInRangeWhere, dated by refundedAt), whenever the sale was; the
// refund of an unapplied online payment (no sale) is never subtracted.

import { localDateInTz, wallClockToUtc } from '../../features/attendance/attendance-utils'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { currentSubscriptionWhere } from '../subscriptions/current-subscriptions'
import { DAY_MS } from '../subscriptions/freeze-dates'

export type SubAmountRow = { amountPaid: number; currency: string }
export type ActiveSubRow = SubAmountRow & {
    startDate: Date | null
    endDate: Date | null
    isPaid: boolean
    refundedAmount: number
}
export type DatedSubRow = SubAmountRow & {
    createdAt: Date
    paidAt?: Date | null
}
export type PlanSubRow = SubAmountRow & { planId: string; planName: string }
// A refund of a sale, keyed like its sale: `planId` is the tariff of the
// abonement or the event of the ticket (as ticketRevenueRow keys it).
export type RefundRow = {
    amount: number
    currency: string
    refundedAt: Date
    planId: string
    planName: string
}

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

// Prisma `where` for «refunds of sales made in this range» (metric `refunds`):
// a refund of an abonement or a ticket, by refund date. A refund with only
// paymentId (an unapplied online payment) is not a sale's and never counts.
export const refundsInRangeWhere = (range: { gte?: Date; lte?: Date }) => ({
    refundedAt: range,
    OR: [{ subscriptionId: { not: null } }, { eventRegistrationId: { not: null } }],
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

// One subscription's contribution to MRR: its paid amount net of refunds,
// normalised to a 30-day month over its own term. Open-ended (no endDate) rows
// aren't a recurring monthly figure, so they contribute 0 — as does one still
// waiting for its first visit (no start yet), one not paid for yet and one
// refunded in full.
export const monthlyEquivalent = (row: ActiveSubRow): number => {
    if (!row.isPaid || !row.endDate || !row.startDate) return 0
    const days = Math.max(
        1,
        Math.round((row.endDate.getTime() - row.startDate.getTime()) / DAY_MS),
    )
    return Math.round(((row.amountPaid - row.refundedAmount) * 30) / days)
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

// The refunds in one currency, summed.
const sumRefunds = (refunds: readonly RefundRow[], currency: string | null): number =>
    refunds.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.amount, 0)

// Total paid across rows minus the refunds passed (caller pre-filters both to
// one window), counting only the dominant currency of the sales (mixed-currency
// clubs get one coherent figure); with no sales, the refunds' currency. Used
// for the "today" revenue glance.
export const sumRevenue = (
    rows: SubAmountRow[],
    refunds: readonly RefundRow[] = [],
): { amount: number; currency: string | null } => {
    const currency =
        dominantCurrency(rows) ??
        dominantCurrency(refunds.map((r) => ({ amountPaid: r.amount, currency: r.currency })))
    const amount = rows
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + r.amountPaid, 0)
    return { amount: amount - sumRefunds(refunds, currency), currency }
}

// Metric `revenue_30d`'s rule over any window [gte, lt): sales paid in it −
// refunds of sales made in it, in the given currency (the caller's figure's,
// e.g. computeRevenue's). The dashboard's previous 30 days, the AI's month.
export const netRevenue = (
    sales: DatedSubRow[],
    refunds: readonly RefundRow[],
    currency: string | null,
    range: { gte: Date; lt?: Date },
): number => {
    const inRange = (d: Date) => d >= range.gte && (range.lt === undefined || d < range.lt)
    const received = sales
        .filter((r) => r.currency === currency && inRange(paidOn(r)))
        .reduce((sum, r) => sum + r.amountPaid, 0)
    return received - sumRefunds(refunds.filter((r) => inRange(r.refundedAt)), currency)
}

export type RevenueSummary = {
    // Sales − refunds of sales in the window (metric `revenue_30d`).
    revenue30d: number
    // The refunds subtracted (metric `refunds`).
    refunded30d: number
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
// first, current month last), summing only the dominant `currency`. A refund
// lowers the month it was made in. Months with no sales are emitted with
// revenue 0 so the chart has a continuous axis.
export const revenueTrend = (
    rows: DatedSubRow[],
    now: Date,
    currency: string | null,
    tz: string,
    months = 6,
    refunds: readonly RefundRow[] = [],
): { month: string; revenue: number }[] => {
    const current = monthKey(now, tz)
    const buckets = new Map<string, number>()
    for (let i = months - 1; i >= 0; i--) buckets.set(shiftMonth(current, -i), 0)
    const add = (at: Date, amount: number) => {
        const key = monthKey(at, tz)
        const prev = buckets.get(key)
        // Ignore anything outside the window (defensive — caller pre-filters).
        if (prev !== undefined) buckets.set(key, prev + amount)
    }
    for (const r of rows) {
        if (currency && r.currency !== currency) continue
        add(paidOn(r), r.amountPaid)
    }
    for (const r of refunds) {
        if (currency && r.currency !== currency) continue
        add(r.refundedAt, -r.amount)
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

// Sales grouped by tariff over the rows passed (caller pre-filters both lists
// to a window), net of the refunds of each tariff's sales (a refund is not a
// sale: `count` is sales only), dominant currency only, highest-revenue first.
export const revenueByPlan = (
    rows: PlanSubRow[],
    currency: string | null,
    refunds: readonly RefundRow[] = [],
): PlanBreakdownRow[] => {
    const acc = new Map<string, PlanBreakdownRow>()
    const add = (r: { planId: string; planName: string }, revenue: number, count: number) => {
        const cur = acc.get(r.planId) ?? {
            planId: r.planId,
            planName: r.planName,
            count: 0,
            revenue: 0,
        }
        cur.count += count
        cur.revenue += revenue
        acc.set(r.planId, cur)
    }
    for (const r of rows) {
        if (currency && r.currency !== currency) continue
        add(r, r.amountPaid, 1)
    }
    for (const r of refunds) {
        if (currency && r.currency !== currency) continue
        add(r, -r.amount, 0)
    }
    return [...acc.values()].sort((a, b) => b.revenue - a.revenue)
}

// Collapse current + recent rows into the money figures: revenue30d = the
// window's sales − the window's refunds of sales. To keep the number coherent
// for mixed-currency clubs, MRR and revenue30d sum only the dominant currency
// (of the current abonements, else of the sales — never picked by refunds).
export const computeRevenue = (
    current: ActiveSubRow[],
    recent30: SubAmountRow[],
    refunds30: readonly RefundRow[],
): RevenueSummary => {
    const currency = dominantCurrency(current) ?? dominantCurrency(recent30)
    const mrr = current
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + monthlyEquivalent(r), 0)
    const sales = recent30
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + r.amountPaid, 0)
    const refunded30d = sumRefunds(refunds30, currency)
    return { revenue30d: sales - refunded30d, refunded30d, mrr, currency }
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
        select: {
            amountPaid: true,
            refundedAmount: true,
            currency: true,
            isPaid: true,
            startDate: true,
            endDate: true,
        },
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

export const refundRevenueSelect = {
    amount: true,
    currency: true,
    refundedAt: true,
    subscription: { select: { planId: true, plan: { select: { name: true } } } },
    eventRegistration: { select: { eventId: true, event: { select: { title: true } } } },
} as const

// A refund of a sale as a revenue row, keyed like its sale (tariff / event).
// Only for refunds read through refundsInRangeWhere (a sale is always set).
export const refundRevenueRow = (r: {
    amount: number
    currency: string
    refundedAt: Date
    subscription: { planId: string; plan: { name: string } } | null
    eventRegistration: { eventId: string; event: { title: string } } | null
}): RefundRow => ({
    amount: r.amount,
    currency: r.currency,
    refundedAt: r.refundedAt,
    planId: r.subscription?.planId ?? r.eventRegistration?.eventId ?? '',
    planName: r.subscription?.plan.name ?? r.eventRegistration?.event.title ?? '',
})

// Refunds of sales since `since`, dated by refund — subtracted from metrics
// `revenue_30d`, `revenue_today`, the trend and the breakdown (metric
// `refunds`).
export const loadRefunds = async (
    prisma: PrismaService,
    workspaceId: string,
    since: Date,
): Promise<RefundRow[]> =>
    (
        await prisma.refund.findMany({
            where: { workspaceId, ...refundsInRangeWhere({ gte: since }) },
            select: refundRevenueSelect,
        })
    ).map(refundRevenueRow)

// The trailing-30-day window of metric `revenue_30d`.
export const revenueWindowStart = (now: Date): Date => new Date(now.getTime() - 30 * DAY_MS)
