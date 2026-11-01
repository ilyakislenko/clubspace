// The pure date and lifecycle rules of platform billing, unit-tested directly
// (billing-rules.spec.ts).

export type BillingStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED'

export const BYTES_PER_GB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000

export const laterOf = (a: Date, b: Date | null): Date => (b && b > a ? b : a)

export const addDays = (from: Date, days: number): Date =>
    new Date(from.getTime() + days * DAY_MS)

// Calendar months in UTC, clamped to the target month's last day (31 Jan + 1
// month = 28/29 Feb), so a monthly charge never drifts past a short month.
export const addMonths = (from: Date, months: number): Date => {
    const d = new Date(from.getTime())
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + months)
    const last = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate()
    d.setUTCDate(Math.min(day, last))
    return d
}

// First moment of the calendar month (UTC) that contains `at`.
export const monthStart = (at: Date): Date =>
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))

// A platform-console date (YYYY-MM-DD, inclusive) as the last moment of that
// day in Moscow — the operator means «through the 15th», not «until the 15th
// begins».
export const endOfDayMoscow = (ymd: string): Date =>
    new Date(`${ymd}T23:59:59.999+03:00`)

export type BillingTransition =
    | { status: 'PAST_DUE'; pastDueSince: Date }
    | { status: 'SUSPENDED' }
    | { status: 'ACTIVE'; currentPeriodEnd: Date }

// The automatic lifecycle, one step per call. A trial that ended, or a paid
// period that ran out, goes PAST_DUE (dated from when it ran out) — unless the
// platform made the subscription free past now (freeUntil), in which case the
// club stays ACTIVE through that date. PAST_DUE turns SUSPENDED once the grace
// period has passed. ACTIVE without a period end and SUSPENDED only change by
// hand in the platform console.
export const nextBillingTransition = (
    row: {
        status: BillingStatus
        trialEndsAt: Date | null
        currentPeriodEnd: Date | null
        pastDueSince: Date | null
        freeUntil: Date | null
    },
    now: Date,
    graceDays: number,
): BillingTransition | null => {
    const freeAhead = row.freeUntil && row.freeUntil > now ? row.freeUntil : null
    if (row.status === 'TRIAL') {
        if (!row.trialEndsAt || row.trialEndsAt > now) return null
        // Paid during the trial: the paid period follows on.
        const paidAhead =
            row.currentPeriodEnd && row.currentPeriodEnd > now
                ? row.currentPeriodEnd
                : null
        const activeUntil =
            paidAhead && freeAhead
                ? laterOf(paidAhead, freeAhead)
                : (paidAhead ?? freeAhead)
        if (activeUntil) return { status: 'ACTIVE', currentPeriodEnd: activeUntil }
        return { status: 'PAST_DUE', pastDueSince: row.trialEndsAt }
    }
    if (row.status === 'ACTIVE') {
        if (!row.currentPeriodEnd || row.currentPeriodEnd > now) return null
        if (freeAhead) return { status: 'ACTIVE', currentPeriodEnd: freeAhead }
        return { status: 'PAST_DUE', pastDueSince: row.currentPeriodEnd }
    }
    if (row.status === 'PAST_DUE') {
        const since = row.pastDueSince ?? now
        if (addDays(since, graceDays) <= now) return { status: 'SUSPENDED' }
        return null
    }
    return null
}

// When the next charge falls due: the end of the trial (or of a free period
// granted past it, or of a period paid during it), the end of the paid
// period, or now for an overdue club. null = nothing scheduled (ACTIVE
// without a period end, or suspended).
export const nextChargeAt = (
    row: {
        status: BillingStatus
        trialEndsAt: Date | null
        currentPeriodEnd: Date | null
        freeUntil: Date | null
    },
    now: Date,
): Date | null => {
    switch (row.status) {
        case 'TRIAL': {
            const trialEnd = row.trialEndsAt ?? now
            // A period end before the trial's is a leftover of an earlier
            // paid spell, not a payment made during this trial.
            return laterOf(laterOf(trialEnd, row.freeUntil), row.currentPeriodEnd)
        }
        case 'ACTIVE':
            return row.currentPeriodEnd
        case 'PAST_DUE':
            return now
        case 'SUSPENDED':
            return null
    }
}

// Where the period a payment made now buys begins: right after what the club
// already has (the trial, a free period, the paid period), or now for an
// overdue or suspended club — the same rule as the console's «отметить
// оплату», so paying early never loses days.
export const paidPeriodStart = (
    row: Parameters<typeof nextChargeAt>[0],
    now: Date,
): Date => laterOf(now, nextChargeAt(row, now))

// The renewal job charges a saved card this long before the period ends, so
// a refused card still has the day to be fixed before the club goes overdue.
export const AUTOPAY_LEAD_MS = 24 * 60 * 60 * 1000

// After the n-th refused renewal in a row the next try comes 1, 2, then every
// 3 days — inside the grace period, after which the daily pass suspends.
export const autopayRetryAt = (now: Date, failedAttempts: number): Date =>
    addDays(now, Math.min(Math.max(failedAttempts, 1), 3))

// The part of a module's price for the rest of the paid period when the club
// connects it mid-period: the module's monthly price × the period's months ×
// the share of the period still ahead (a free period counts as already
// paid), then the same discounts the period got (annual prepay, the
// platform's percent). Whole rubles.
export const moduleProRata = (p: {
    monthlyPrice: number
    periodMonths: number
    periodEnd: Date
    now: Date
    freeUntil: Date | null
    annualDiscountPercent: number
    discountPercent: number
}): number => {
    const months = Math.max(1, Math.floor(p.periodMonths))
    const periodStart = addMonths(p.periodEnd, -months)
    const from = laterOf(laterOf(periodStart, p.now), p.freeUntil)
    const remaining = p.periodEnd.getTime() - from.getTime()
    if (remaining <= 0 || p.monthlyPrice <= 0) return 0
    const share = Math.min(
        1,
        remaining / (p.periodEnd.getTime() - periodStart.getTime()),
    )
    let amount = p.monthlyPrice * months * share
    if (months === 12 && p.annualDiscountPercent > 0) {
        amount -= (amount * p.annualDiscountPercent) / 100
    }
    const percent = Math.min(100, Math.max(0, p.discountPercent))
    amount -= (amount * percent) / 100
    return Math.round(amount)
}

// What the club pays now to connect a module: the pro-rata part of the paid
// period still ahead (a period paid during the trial counts), or null when
// the module simply goes on the next bill (the trial without a paid period,
// no scheduled period end) or cannot be connected (overdue, suspended).
export const moduleConnectPrice = (
    row: {
        status: BillingStatus
        currentPeriodEnd: Date | null
        billingPeriodMonths: number
        freeUntil: Date | null
        discountPercent: number
    },
    monthlyPrice: number,
    annualDiscountPercent: number,
    now: Date,
): number | null => {
    if (row.status !== 'ACTIVE' && row.status !== 'TRIAL') return null
    if (!row.currentPeriodEnd || row.currentPeriodEnd <= now) return null
    return moduleProRata({
        monthlyPrice,
        periodMonths: row.billingPeriodMonths,
        periodEnd: row.currentPeriodEnd,
        now,
        freeUntil: row.freeUntil,
        annualDiscountPercent,
        discountPercent: row.discountPercent,
    })
}

// Why a club is closed to its members, or null when it is open. A platform
// switch-off (isActive = false) always applies; a billing suspension only
// while billing is enabled — a self-hosted install never locks a club out.
export const suspensionReason = (
    workspace: {
        isActive: boolean
        billing: { status: BillingStatus } | null
    },
    billingEnabled: boolean,
): 'INACTIVE' | 'SUSPENDED' | null => {
    if (!workspace.isActive) return 'INACTIVE'
    if (billingEnabled && workspace.billing?.status === 'SUSPENDED') {
        return 'SUSPENDED'
    }
    return null
}
