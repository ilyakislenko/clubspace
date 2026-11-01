import {
    addDays,
    type BillingStatus,
    endOfDayMoscow,
} from '../../domains/billing/billing-rules'

type CurrentBilling = {
    status: BillingStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
    setupFeePaidAt: Date | null
}

export type BillingPatch = {
    status?: BillingStatus
    trialEndsAt?: Date
    currentPeriodEnd?: Date | null
    pastDueSince?: null
    freeUntil?: Date | null
    setupFeePaidAt?: Date
    paidTierCode?: string
}

const laterOf = (a: Date, b: Date | null): Date =>
    b && b > a ? b : a

// What a status action from the platform console writes. Pure, so the date
// arithmetic is tested on its own (platform-billing-utils.spec.ts).
//  - extendTrial: back to TRIAL, `days` past the later of now and the current
//    trial end (extending an expired trial starts from today).
//  - markPaid: ACTIVE, `days` past the later of now and the current period
//    end (paying early never loses paid days); the first payment also covers
//    the setup fee, and records the tier it paid for.
//  - extendPeriod: the same dates as markPaid, without recording a payment
//    (a goodwill extension).
//  - suspend: SUSPENDED, dates untouched.
//  - resume: ACTIVE. A period end already in the past is cleared, otherwise
//    the daily pass would suspend the club again that night; the operator
//    marks a paid period to start counting again.
export const billingStatusPatch = (
    kind: 'extendTrial' | 'markPaid' | 'extendPeriod' | 'suspend' | 'resume',
    current: CurrentBilling,
    now: Date,
    days = 0,
    tierCode = '',
): BillingPatch => {
    switch (kind) {
        case 'extendTrial':
            return {
                status: 'TRIAL',
                trialEndsAt: addDays(laterOf(now, current.trialEndsAt), days),
                pastDueSince: null,
            }
        case 'markPaid':
            return {
                status: 'ACTIVE',
                currentPeriodEnd: addDays(
                    laterOf(now, current.currentPeriodEnd),
                    days,
                ),
                pastDueSince: null,
                paidTierCode: tierCode,
                ...(current.setupFeePaidAt ? {} : { setupFeePaidAt: now }),
            }
        case 'extendPeriod':
            return {
                status: 'ACTIVE',
                currentPeriodEnd: addDays(
                    laterOf(now, current.currentPeriodEnd),
                    days,
                ),
                pastDueSince: null,
            }
        case 'suspend':
            return { status: 'SUSPENDED' }
        case 'resume':
            return {
                status: 'ACTIVE',
                pastDueSince: null,
                ...(current.currentPeriodEnd && current.currentPeriodEnd <= now
                    ? { currentPeriodEnd: null }
                    : {}),
            }
    }
}

// «Пару месяцев бесплатно»: the whole subscription is free through `ymd`
// (inclusive, Moscow), or the promo is cleared with null. A free period
// reaching past now also lifts an overdue club back to ACTIVE and moves its
// next charge to the end of the free period; a trial keeps running and turns
// ACTIVE through the free period when it ends (nextBillingTransition); a
// suspended club stays suspended until the operator resumes it.
export const freeUntilPatch = (
    ymd: string | null,
    current: CurrentBilling,
    now: Date,
): BillingPatch => {
    if (ymd === null) return { freeUntil: null }
    const freeUntil = endOfDayMoscow(ymd)
    if (freeUntil <= now) return { freeUntil }
    if (current.status === 'PAST_DUE') {
        return {
            freeUntil,
            status: 'ACTIVE',
            pastDueSince: null,
            currentPeriodEnd: laterOf(freeUntil, current.currentPeriodEnd),
        }
    }
    if (current.status === 'ACTIVE' && current.currentPeriodEnd) {
        return {
            freeUntil,
            currentPeriodEnd: laterOf(freeUntil, current.currentPeriodEnd),
        }
    }
    return { freeUntil }
}
