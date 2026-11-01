// The pure date and lifecycle rules of platform billing, unit-tested directly
// (billing-rules.spec.ts).

export type BillingStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED'

export const BYTES_PER_GB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000

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
        if (freeAhead) return { status: 'ACTIVE', currentPeriodEnd: freeAhead }
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
// granted past it), the end of the paid period, or now for an overdue club.
// null = nothing scheduled (ACTIVE without a period end, or suspended).
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
            return row.freeUntil && row.freeUntil > trialEnd
                ? row.freeUntil
                : trialEnd
        }
        case 'ACTIVE':
            return row.currentPeriodEnd
        case 'PAST_DUE':
            return now
        case 'SUSPENDED':
            return null
    }
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
