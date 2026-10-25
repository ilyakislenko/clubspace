// Pure revenue math for the owner dashboard, split out so it can be unit
// tested without a database. Amounts stay in the subscription's own integer
// unit; callers pass already-active rows (status ACTIVE, not expired) and the
// rows paid in the trailing 30 days. Money counts PAID rows only («Ожидает
// оплаты» is a receivable, not revenue): every reader goes through
// paidInRangeWhere(), and a row's revenue date is paidOn().

const DAY_MS = 24 * 3600 * 1000

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
    activeSubscriptions: number
    revenue30d: number
    mrr: number
    currency: string | null
}

// UTC year-month key, e.g. "2026-07". Bucketing by UTC keeps the trend
// deterministic and consistent with the rest of the dashboard's date math,
// which is timezone-agnostic.
const monthKey = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

// Revenue per calendar month for the last `months` months (oldest first,
// current month last), summing only the dominant `currency`. Months with no
// sales are emitted with revenue 0 so the chart has a continuous axis.
export const revenueTrend = (
    rows: DatedSubRow[],
    now: Date,
    currency: string | null,
    months = 6,
): { month: string; revenue: number }[] => {
    const buckets = new Map<string, number>()
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
        )
        buckets.set(monthKey(d), 0)
    }
    for (const r of rows) {
        if (currency && r.currency !== currency) continue
        const key = monthKey(paidOn(r))
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

// Collapse active + recent rows into the dashboard's revenue card. To keep the
// number coherent for mixed-currency clubs, MRR and revenue30d sum only the
// dominant currency; activeSubscriptions counts every active row.
export const computeRevenue = (
    active: ActiveSubRow[],
    recent30: SubAmountRow[],
): RevenueSummary => {
    const currency = dominantCurrency(active) ?? dominantCurrency(recent30)
    const mrr = active
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + monthlyEquivalent(r), 0)
    const revenue30d = recent30
        .filter((r) => r.currency === currency)
        .reduce((sum, r) => sum + r.amountPaid, 0)
    return {
        activeSubscriptions: active.length,
        revenue30d,
        mrr,
        currency,
    }
}
