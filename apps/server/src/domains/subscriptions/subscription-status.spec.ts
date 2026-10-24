import { isAwaitingFirstVisit, isSubscriptionUsable } from './subscription-status'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const future = new Date('2026-09-04T00:00:00.000Z')
const past = new Date('2026-07-04T00:00:00.000Z')

describe('isSubscriptionUsable', () => {
    it('accepts an ACTIVE subscription that has not ended', () => {
        expect(
            isSubscriptionUsable({ status: 'ACTIVE', endDate: future }, NOW),
        ).toBe(true)
    })

    it('treats a null endDate as no time limit', () => {
        expect(
            isSubscriptionUsable({ status: 'ACTIVE', endDate: null }, NOW),
        ).toBe(true)
    })

    // The bug this helper exists for: the pointer outlives the subscription.
    it('rejects one whose end date has passed', () => {
        expect(
            isSubscriptionUsable({ status: 'ACTIVE', endDate: past }, NOW),
        ).toBe(false)
    })

    it('rejects exactly at the end date', () => {
        expect(isSubscriptionUsable({ status: 'ACTIVE', endDate: NOW }, NOW)).toBe(
            false,
        )
    })

    it.each(['CANCELLED', 'EXPIRED', 'SUSPENDED'])('rejects %s', (status) => {
        expect(isSubscriptionUsable({ status, endDate: future }, NOW)).toBe(false)
    })

    it('rejects null/undefined', () => {
        expect(isSubscriptionUsable(null, NOW)).toBe(false)
        expect(isSubscriptionUsable(undefined, NOW)).toBe(false)
    })

    // A used-up pack is still the current pack — it must read "0 / 12", not
    // disappear, and running out never revokes access.
    it('does not care about the class balance', () => {
        expect(
            isSubscriptionUsable({ status: 'ACTIVE', endDate: future }, NOW),
        ).toBe(true)
    })
})

describe('isAwaitingFirstVisit', () => {
    it('is true for an ACTIVE abonement with no start date', () => {
        expect(isAwaitingFirstVisit({ status: 'ACTIVE', startDate: null })).toBe(true)
    })

    it('is false once started, when not ACTIVE, or without a subscription', () => {
        expect(isAwaitingFirstVisit({ status: 'ACTIVE', startDate: past })).toBe(false)
        expect(isAwaitingFirstVisit({ status: 'CANCELLED', startDate: null })).toBe(false)
        expect(isAwaitingFirstVisit(null)).toBe(false)
        expect(isAwaitingFirstVisit(undefined)).toBe(false)
    })

    it('still counts a pending abonement as usable (it is the current one)', () => {
        expect(isSubscriptionUsable({ status: 'ACTIVE', endDate: null }, NOW)).toBe(true)
    })
})
