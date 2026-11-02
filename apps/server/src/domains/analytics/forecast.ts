// Revenue forecast and trial conversion. Pure; the snapshot service feeds one
// member's abonements at a time and stores the pieces, the screen sums them
// over the staff member's scope.
//
// Renewal probability: the club's own history — of the abonements that ended
// 14-180 days ago, the share whose holder bought the next one no later than 14
// days after the end — scaled down by the member's churn score:
// p = clubRate × (1 − score/100). Each future renewal of a running abonement
// (every `durationDays` after its end) needs the previous one, so the k-th
// renewal inside the horizon counts with p^k.
import { DAY_MS } from '../subscriptions/freeze-dates'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'

export const FORECAST_RULES = {
    defaultRenewalRate: 0.7,
    minRenewalSample: 10,
    historyDays: 180,
    // An abonement must have ended at least this long ago to be judged.
    settleDays: 14,
    // A purchase up to this many days after the end still counts as renewal.
    renewGraceDays: 14,
    // A lapsed abonement (no current one in its scope) is still expected back
    // within this many days of its end.
    lapsedDays: 30,
    defaultPeriodDays: 30,
    // Trials judged for conversion: started 14..180 days ago.
    trialSettleDays: 14,
} as const

export type ForecastSubscription = {
    id: string
    status: string
    startDate: Date | null
    endDate: Date | null
    createdAt: Date
    durationDays: number | null
    amountPaid: number
    isTrial: boolean
    // Sorted scope (empty = club-wide).
    directionIds: string[]
}

export type MemberForecast = {
    potential30: number
    expected30: number
    potential90: number
    expected90: number
}

export const memberRenewalProbability = (clubRate: number, score: number): number =>
    Math.round(clubRate * (1 - Math.min(100, Math.max(0, score)) / 100) * 1000) / 1000

export const clubRenewalRate = (
    due: number,
    done: number,
): { rate: number | null; effective: number } => {
    const rate = due >= FORECAST_RULES.minRenewalSample ? done / due : null
    return { rate, effective: rate ?? FORECAST_RULES.defaultRenewalRate }
}

const notCancelledPaid = (s: ForecastSubscription): boolean =>
    !s.isTrial && s.status !== 'CANCELLED'

// Abonements of the member that ended 14-180 days ago, and how many of them
// were followed by a newer purchase no later than 14 days after the end.
// `judgedIds` limits which abonements are judged (a former member's kept rows)
// while every purchase still counts as their renewal (one bought after
// rejoining too).
export const renewalHistory = (
    now: Date,
    subs: ReadonlyArray<ForecastSubscription>,
    judgedIds?: ReadonlySet<string>,
): { due: number; done: number } => {
    const paid = subs.filter(notCancelledPaid)
    let due = 0
    let done = 0
    for (const e of paid) {
        if (!e.endDate || (judgedIds && !judgedIds.has(e.id))) continue
        const age = now.getTime() - e.endDate.getTime()
        if (
            age < FORECAST_RULES.settleDays * DAY_MS ||
            age > FORECAST_RULES.historyDays * DAY_MS
        ) {
            continue
        }
        due += 1
        const limit = e.endDate.getTime() + FORECAST_RULES.renewGraceDays * DAY_MS
        if (
            paid.some(
                (s) =>
                    s.id !== e.id &&
                    s.createdAt.getTime() > e.createdAt.getTime() &&
                    s.createdAt.getTime() <= limit,
            )
        ) {
            done += 1
        }
    }
    return { due, done }
}

// Expected renewals of one member inside 30 and 90 days. One stream per
// abonement scope: it renews when the coverage of that scope runs out (the
// latest end date, extended by abonements already bought and waiting for
// their first visit), then every period after that.
export const memberForecast = (
    now: Date,
    subs: ReadonlyArray<ForecastSubscription>,
    p: number,
): MemberForecast => {
    const out: MemberForecast = { potential30: 0, expected30: 0, potential90: 0, expected90: 0 }
    const byScope = new Map<string, ForecastSubscription[]>()
    for (const s of subs.filter(notCancelledPaid)) {
        const key = [...s.directionIds].sort().join(',')
        const list = byScope.get(key)
        if (list) list.push(s)
        else byScope.set(key, [s])
    }
    const h30 = now.getTime() + 30 * DAY_MS
    const h90 = now.getTime() + 90 * DAY_MS

    for (const list of byScope.values()) {
        const latest = list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
        const price = latest.amountPaid
        if (price <= 0) continue
        const period = (latest.durationDays ?? FORECAST_RULES.defaultPeriodDays) * DAY_MS

        const current = list.filter((s) => isSubscriptionUsable(s, now))
        let coverageEnd: number
        if (current.length > 0) {
            // A started class pack without an end date has no renewal date.
            if (current.some((s) => s.endDate === null && s.startDate !== null)) continue
            const dated = current.filter((s) => s.endDate !== null)
            coverageEnd =
                dated.length > 0
                    ? Math.max(...dated.map((s) => s.endDate!.getTime()))
                    : now.getTime()
            for (const q of current.filter((s) => s.endDate === null)) {
                coverageEnd += (q.durationDays ?? FORECAST_RULES.defaultPeriodDays) * DAY_MS
            }
        } else {
            const lastEnd = Math.max(
                ...list.filter((s) => s.endDate !== null).map((s) => s.endDate!.getTime()),
            )
            if (!Number.isFinite(lastEnd)) continue
            if (now.getTime() - lastEnd > FORECAST_RULES.lapsedDays * DAY_MS) continue
            coverageEnd = now.getTime()
        }

        let t = Math.max(coverageEnd, now.getTime())
        let chance = p
        while (t < h90) {
            out.potential90 += price
            out.expected90 += price * chance
            if (t < h30) {
                out.potential30 += price
                out.expected30 += price * chance
            }
            t += period
            chance *= p
        }
    }
    out.expected30 = Math.round(out.expected30)
    out.expected90 = Math.round(out.expected90)
    return out
}

// The member's first free trial and the first paid abonement bought after it.
export const trialFacts = (
    subs: ReadonlyArray<ForecastSubscription>,
): { trialStartedAt: Date | null; trialConvertedAt: Date | null } => {
    const trial = subs
        .filter((s) => s.isTrial && s.status !== 'CANCELLED')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    if (!trial) return { trialStartedAt: null, trialConvertedAt: null }
    const paid = subs
        .filter(
            (s) =>
                !s.isTrial &&
                s.status !== 'CANCELLED' &&
                s.amountPaid > 0 &&
                s.createdAt.getTime() >= trial.createdAt.getTime(),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    return {
        trialStartedAt: trial.startDate ?? trial.createdAt,
        trialConvertedAt: paid?.createdAt ?? null,
    }
}

export type TrialConversion = {
    trials: number
    converted: number
    rate: number | null
    medianDaysToPay: number | null
}

// Trials that started 14-180 days ago: the share converted to a paid
// abonement and the median days from the trial to the purchase.
export const trialConversion = (
    now: Date,
    rows: ReadonlyArray<{ trialStartedAt: Date | null; trialConvertedAt: Date | null }>,
): TrialConversion => {
    const judgedRows = rows.filter(
        (r) =>
            r.trialStartedAt &&
            now.getTime() - r.trialStartedAt.getTime() >=
                FORECAST_RULES.trialSettleDays * DAY_MS &&
            now.getTime() - r.trialStartedAt.getTime() <=
                FORECAST_RULES.historyDays * DAY_MS,
    )
    const days = judgedRows
        .filter((r) => r.trialConvertedAt)
        .map((r) =>
            Math.max(
                0,
                Math.round(
                    (r.trialConvertedAt!.getTime() - r.trialStartedAt!.getTime()) / DAY_MS,
                ),
            ),
        )
        .sort((a, b) => a - b)
    const mid = Math.floor(days.length / 2)
    return {
        trials: judgedRows.length,
        converted: days.length,
        rate: judgedRows.length > 0 ? days.length / judgedRows.length : null,
        medianDaysToPay:
            days.length === 0
                ? null
                : days.length % 2 === 1
                  ? days[mid]
                  : Math.round((days[mid - 1] + days[mid]) / 2),
    }
}
