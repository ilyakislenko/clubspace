import { billingStatusPatch, freeUntilPatch } from './platform-billing-utils'

const now = new Date('2026-11-10T12:00:00.000Z')
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

const current = (over: Record<string, unknown> = {}) => ({
    status: 'ACTIVE' as const,
    trialEndsAt: null,
    currentPeriodEnd: null,
    setupFeePaidAt: null,
    ...over,
})

describe('billingStatusPatch', () => {
    it('extends a running trial from its end, an expired one from today', () => {
        expect(
            billingStatusPatch(
                'extendTrial',
                current({ status: 'TRIAL', trialEndsAt: day('2026-11-20') }),
                now,
                7,
            ),
        ).toEqual({
            status: 'TRIAL',
            trialEndsAt: day('2026-11-27'),
            pastDueSince: null,
        })
        expect(
            billingStatusPatch(
                'extendTrial',
                current({ status: 'PAST_DUE', trialEndsAt: day('2026-11-01') }),
                now,
                7,
            ).trialEndsAt,
        ).toEqual(day('2026-11-17'))
    })

    it('an early payment keeps the paid days left; the first one covers the setup fee', () => {
        expect(
            billingStatusPatch(
                'markPaid',
                current({ currentPeriodEnd: day('2026-11-15') }),
                now,
                30,
                'club',
            ),
        ).toEqual({
            status: 'ACTIVE',
            currentPeriodEnd: day('2026-12-15'),
            pastDueSince: null,
            paidTierCode: 'club',
            setupFeePaidAt: now,
        })
        const paidBefore = current({ setupFeePaidAt: day('2026-10-01') })
        const again = billingStatusPatch('markPaid', paidBefore, now, 30, 'pro')
        expect(again.currentPeriodEnd).toEqual(day('2026-12-10'))
        expect(again).not.toHaveProperty('setupFeePaidAt')
    })

    it('extendPeriod moves the period end without recording a payment', () => {
        expect(
            billingStatusPatch(
                'extendPeriod',
                current({ status: 'PAST_DUE', currentPeriodEnd: day('2026-11-01') }),
                now,
                14,
            ),
        ).toEqual({
            status: 'ACTIVE',
            currentPeriodEnd: day('2026-11-24'),
            pastDueSince: null,
        })
    })

    it('suspend only flips the status', () => {
        expect(billingStatusPatch('suspend', current(), now)).toEqual({
            status: 'SUSPENDED',
        })
    })

    it('resume clears a lapsed period end so the nightly pass leaves it be', () => {
        expect(
            billingStatusPatch(
                'resume',
                current({
                    status: 'SUSPENDED',
                    currentPeriodEnd: day('2026-11-01'),
                }),
                now,
            ),
        ).toEqual({ status: 'ACTIVE', pastDueSince: null, currentPeriodEnd: null })
        expect(
            billingStatusPatch(
                'resume',
                current({
                    status: 'SUSPENDED',
                    currentPeriodEnd: day('2026-12-01'),
                }),
                now,
            ),
        ).toEqual({ status: 'ACTIVE', pastDueSince: null })
    })
})

describe('freeUntilPatch', () => {
    const through = (ymd: string) => new Date(`${ymd}T23:59:59.999+03:00`)

    it('clears the promo with null', () => {
        expect(freeUntilPatch(null, current(), now)).toEqual({ freeUntil: null })
    })

    it('lifts an overdue club to ACTIVE through the free period', () => {
        expect(
            freeUntilPatch(
                '2027-01-10',
                current({ status: 'PAST_DUE', currentPeriodEnd: day('2026-11-01') }),
                now,
            ),
        ).toEqual({
            freeUntil: through('2027-01-10'),
            status: 'ACTIVE',
            pastDueSince: null,
            currentPeriodEnd: through('2027-01-10'),
        })
    })

    it('moves an active club\'s next charge to the end of the free period, never earlier', () => {
        expect(
            freeUntilPatch('2027-01-10', current({ currentPeriodEnd: day('2026-12-01') }), now)
                .currentPeriodEnd,
        ).toEqual(through('2027-01-10'))
        expect(
            freeUntilPatch('2026-12-01', current({ currentPeriodEnd: day('2027-02-01') }), now)
                .currentPeriodEnd,
        ).toEqual(day('2027-02-01'))
    })

    it('a trial keeps running; a past date only records the date', () => {
        expect(
            freeUntilPatch('2027-01-10', current({ status: 'TRIAL', trialEndsAt: day('2026-11-20') }), now),
        ).toEqual({ freeUntil: through('2027-01-10') })
        expect(freeUntilPatch('2026-11-01', current({ status: 'PAST_DUE' }), now)).toEqual({
            freeUntil: through('2026-11-01'),
        })
    })
})
