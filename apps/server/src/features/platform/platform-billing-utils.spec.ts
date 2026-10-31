import { billingStatusPatch } from './platform-billing-utils'

const now = new Date('2026-11-10T12:00:00.000Z')
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

const current = (over: Record<string, unknown> = {}) => ({
    status: 'ACTIVE' as const,
    trialEndsAt: null,
    currentPeriodEnd: null,
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

    it('an early payment keeps the paid days left', () => {
        expect(
            billingStatusPatch(
                'markPaid',
                current({ currentPeriodEnd: day('2026-11-15') }),
                now,
                30,
            ),
        ).toEqual({
            status: 'ACTIVE',
            currentPeriodEnd: day('2026-12-15'),
            pastDueSince: null,
        })
        expect(
            billingStatusPatch('markPaid', current(), now, 30).currentPeriodEnd,
        ).toEqual(day('2026-12-10'))
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
