// Pure revenue math for the owner dashboard, split out so it can be unit
// tested without a database. Amounts stay in the subscription's own integer
// unit; callers pass already-active rows (status ACTIVE, not expired) and the
// rows created in the trailing 30 days.

const DAY_MS = 24 * 3600 * 1000

export type SubAmountRow = { amountPaid: number; currency: string }
export type ActiveSubRow = SubAmountRow & {
    startDate: Date
    endDate: Date | null
}

// One subscription's contribution to MRR: its paid amount normalised to a
// 30-day month over its own term. Open-ended (no endDate) rows aren't a
// recurring monthly figure, so they contribute 0.
export const monthlyEquivalent = (row: ActiveSubRow): number => {
    if (!row.endDate) return 0
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

export type RevenueSummary = {
    activeSubscriptions: number
    revenue30d: number
    mrr: number
    currency: string | null
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
