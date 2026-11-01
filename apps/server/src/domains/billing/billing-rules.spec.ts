import {
    addMonths,
    endOfDayMoscow,
    monthStart,
    nextBillingTransition,
    nextChargeAt,
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
