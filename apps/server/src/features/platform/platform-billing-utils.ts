import {
    addDays,
    type BillingStatus,
} from '../../domains/billing/platform-plans.config'

type CurrentBilling = {
    status: BillingStatus
    trialEndsAt: Date | null
    currentPeriodEnd: Date | null
}

export type BillingPatch = {
    status?: BillingStatus
    trialEndsAt?: Date
    currentPeriodEnd?: Date | null
    pastDueSince?: null
}

const laterOf = (a: Date, b: Date | null): Date =>
    b && b > a ? b : a

// What a status action from the platform console writes. Pure, so the date
// arithmetic is tested on its own (platform-billing-utils.spec.ts).
//  - extendTrial: back to TRIAL, `days` past the later of now and the current
//    trial end (extending an expired trial starts from today).
//  - markPaid: ACTIVE, `days` past the later of now and the current period
//    end (paying early never loses paid days).
//  - suspend: SUSPENDED, dates untouched.
//  - resume: ACTIVE. A period end already in the past is cleared, otherwise
//    the daily pass would suspend the club again that night; the operator
//    marks a paid period to start counting again.
export const billingStatusPatch = (
    kind: 'extendTrial' | 'markPaid' | 'suspend' | 'resume',
    current: CurrentBilling,
    now: Date,
    days = 0,
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
