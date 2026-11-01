import {
    addDays,
    addMonths,
    autopayRetryAt,
    endOfDayMoscow,
    moduleConnectPrice,
    moduleProRata,
    monthStart,
    nextBillingTransition,
    nextChargeAt,
    paidPeriodStart,
    suspensionReason,
} from './billing-rules'

const now = new Date('2026-11-10T12:00:00.000Z')
const before = new Date('2026-11-05T12:00:00.000Z')
const after = new Date('2026-12-05T12:00:00.000Z')

const row = (over: Partial<Parameters<typeof nextBillingTransition>[0]> = {}) => ({
    status: 'ACTIVE' as const,
    trialEndsAt: null,
    currentPeriodEnd: null,
    pastDueSince: null,
    freeUntil: null,
    ...over,
})

describe('nextBillingTransition', () => {
    it('an ended trial goes past due from its end', () => {
        expect(
            nextBillingTransition(row({ status: 'TRIAL', trialEndsAt: before }), now, 7),
        ).toEqual({ status: 'PAST_DUE', pastDueSince: before })
        expect(
            nextBillingTransition(row({ status: 'TRIAL', trialEndsAt: after }), now, 7),
        ).toBeNull()
    })

    it('an ended paid period goes past due; no period end never expires', () => {
        expect(nextBillingTransition(row({ currentPeriodEnd: before }), now, 7)).toEqual({
            status: 'PAST_DUE',
            pastDueSince: before,
        })
        expect(nextBillingTransition(row(), now, 7)).toBeNull()
    })

    it('a platform free period keeps the club ACTIVE through it', () => {
        expect(
            nextBillingTransition(
                row({ status: 'TRIAL', trialEndsAt: before, freeUntil: after }),
                now,
                7,
            ),
        ).toEqual({ status: 'ACTIVE', currentPeriodEnd: after })
        expect(
            nextBillingTransition(row({ currentPeriodEnd: before, freeUntil: after }), now, 7),
        ).toEqual({ status: 'ACTIVE', currentPeriodEnd: after })
        // An expired promo does not help.
        expect(
            nextBillingTransition(row({ currentPeriodEnd: before, freeUntil: before }), now, 7),
        ).toEqual({ status: 'PAST_DUE', pastDueSince: before })
    })

    it('past due turns suspended after the grace days', () => {
        expect(
            nextBillingTransition(
                row({ status: 'PAST_DUE', pastDueSince: new Date('2026-11-03T12:00:00Z') }),
                now,
                7,
            ),
        ).toEqual({ status: 'SUSPENDED' })
        expect(
            nextBillingTransition(row({ status: 'PAST_DUE', pastDueSince: before }), now, 7),
        ).toBeNull()
        expect(nextBillingTransition(row({ status: 'SUSPENDED' }), now, 7)).toBeNull()
    })

    it('a trial paid during the trial turns active through the paid period', () => {
        const paidTo = new Date('2027-01-05T12:00:00.000Z')
        expect(
            nextBillingTransition(
                row({ status: 'TRIAL', trialEndsAt: before, currentPeriodEnd: paidTo }),
                now,
                7,
            ),
        ).toEqual({ status: 'ACTIVE', currentPeriodEnd: paidTo })
        // A free period reaching further wins.
        const freeTo = new Date('2027-03-01T00:00:00.000Z')
        expect(
            nextBillingTransition(
                row({
                    status: 'TRIAL',
                    trialEndsAt: before,
                    currentPeriodEnd: paidTo,
                    freeUntil: freeTo,
                }),
                now,
                7,
            ),
        ).toEqual({ status: 'ACTIVE', currentPeriodEnd: freeTo })
        // A leftover period end from before the trial is not a payment.
        expect(
            nextBillingTransition(
                row({ status: 'TRIAL', trialEndsAt: before, currentPeriodEnd: before }),
                now,
                7,
            ),
        ).toEqual({ status: 'PAST_DUE', pastDueSince: before })
    })
})

describe('nextChargeAt', () => {
    it('follows the status', () => {
        expect(nextChargeAt(row({ status: 'TRIAL', trialEndsAt: after }), now)).toEqual(after)
        // A free period granted past the trial pushes the first charge.
        const later = new Date('2027-02-01T00:00:00Z')
        expect(
            nextChargeAt(row({ status: 'TRIAL', trialEndsAt: after, freeUntil: later }), now),
        ).toEqual(later)
        expect(nextChargeAt(row({ currentPeriodEnd: after }), now)).toEqual(after)
        expect(nextChargeAt(row(), now)).toBeNull()
        expect(nextChargeAt(row({ status: 'PAST_DUE' }), now)).toEqual(now)
        expect(nextChargeAt(row({ status: 'SUSPENDED' }), now)).toBeNull()
    })

    it('a period paid during the trial moves the first charge to its end', () => {
        const paidTo = new Date('2027-01-05T12:00:00.000Z')
        expect(
            nextChargeAt(
                row({ status: 'TRIAL', trialEndsAt: after, currentPeriodEnd: paidTo }),
                now,
            ),
        ).toEqual(paidTo)
        expect(
            nextChargeAt(row({ status: 'TRIAL', trialEndsAt: after, currentPeriodEnd: before }), now),
        ).toEqual(after)
    })
})

describe('paidPeriodStart', () => {
    it('starts after what the club already has, or now', () => {
        expect(paidPeriodStart(row({ status: 'TRIAL', trialEndsAt: after }), now)).toEqual(after)
        expect(paidPeriodStart(row({ status: 'TRIAL', trialEndsAt: before }), now)).toEqual(now)
        expect(paidPeriodStart(row({ currentPeriodEnd: after }), now)).toEqual(after)
        expect(paidPeriodStart(row({ currentPeriodEnd: null }), now)).toEqual(now)
        expect(
            paidPeriodStart(row({ status: 'PAST_DUE', pastDueSince: before }), now),
        ).toEqual(now)
        expect(paidPeriodStart(row({ status: 'SUSPENDED' }), now)).toEqual(now)
    })
})

describe('autopayRetryAt', () => {
    it('retries after 1, 2, then every 3 days', () => {
        expect(autopayRetryAt(now, 1)).toEqual(addDays(now, 1))
        expect(autopayRetryAt(now, 2)).toEqual(addDays(now, 2))
        expect(autopayRetryAt(now, 3)).toEqual(addDays(now, 3))
        expect(autopayRetryAt(now, 9)).toEqual(addDays(now, 3))
        expect(autopayRetryAt(now, 0)).toEqual(addDays(now, 1))
    })
})

describe('module pro rata', () => {
    const periodEnd = new Date('2026-12-01T00:00:00.000Z')
    const base = {
        monthlyPrice: 990,
        periodMonths: 1,
        periodEnd,
        now: new Date('2026-11-16T00:00:00.000Z'),
        freeUntil: null,
        annualDiscountPercent: 15,
        discountPercent: 0,
    }

    it('charges the share of the period still ahead', () => {
        // 15 of November's 30 days left.
        expect(moduleProRata(base)).toBe(495)
        // Not started yet (paid ahead during the trial): the whole period.
        expect(moduleProRata({ ...base, now: new Date('2026-10-20T00:00:00Z') })).toBe(990)
        expect(moduleProRata({ ...base, now: periodEnd })).toBe(0)
        expect(moduleProRata({ ...base, monthlyPrice: 0 })).toBe(0)
    })

    it('counts a free period as paid and applies the period discounts', () => {
        expect(
            moduleProRata({ ...base, freeUntil: new Date('2026-11-26T00:00:00Z') }),
        ).toBe(165)
        expect(moduleProRata({ ...base, discountPercent: 10 })).toBe(446)
        const annualEnd = new Date('2027-11-16T00:00:00.000Z')
        // A full year ahead: 990 × 12 − 15%.
        expect(
            moduleProRata({
                ...base,
                periodMonths: 12,
                periodEnd: annualEnd,
                now: new Date('2026-11-16T00:00:00.000Z'),
            }),
        ).toBe(10098)
    })

    it('connect price: pro rata only with a paid period ahead', () => {
        const billing = {
            status: 'ACTIVE' as const,
            currentPeriodEnd: periodEnd,
            billingPeriodMonths: 1,
            freeUntil: null,
            discountPercent: 0,
        }
        expect(moduleConnectPrice(billing, 990, 15, base.now)).toBe(495)
        expect(
            moduleConnectPrice({ ...billing, status: 'TRIAL', currentPeriodEnd: null }, 990, 15, base.now),
        ).toBeNull()
        expect(moduleConnectPrice({ ...billing, currentPeriodEnd: null }, 990, 15, base.now)).toBeNull()
        expect(moduleConnectPrice({ ...billing, status: 'PAST_DUE' }, 990, 15, base.now)).toBeNull()
        expect(moduleConnectPrice(billing, 990, 15, periodEnd)).toBeNull()
    })
})

describe('date helpers', () => {
    it('addMonths clamps to the end of a short month', () => {
        expect(addMonths(new Date('2027-01-31T10:00:00Z'), 1)).toEqual(
            new Date('2027-02-28T10:00:00Z'),
        )
        expect(addMonths(new Date('2026-12-01T00:00:00Z'), 12)).toEqual(
            new Date('2027-12-01T00:00:00Z'),
        )
    })

    it('monthStart and endOfDayMoscow', () => {
        expect(monthStart(now)).toEqual(new Date('2026-11-01T00:00:00Z'))
        expect(endOfDayMoscow('2027-01-15')).toEqual(new Date('2027-01-15T20:59:59.999Z'))
    })
})

describe('suspensionReason', () => {
    it('closes a switched-off club always, a suspended one only with billing on', () => {
        expect(suspensionReason({ isActive: false, billing: null }, false)).toBe('INACTIVE')
        expect(
            suspensionReason({ isActive: true, billing: { status: 'SUSPENDED' } }, true),
        ).toBe('SUSPENDED')
        expect(
            suspensionReason({ isActive: true, billing: { status: 'SUSPENDED' } }, false),
        ).toBeNull()
    })
})
