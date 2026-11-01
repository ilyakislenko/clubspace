import {
    billingStatusPatch,
    freeUntilPatch,
    promoPresetPlan,
} from './platform-billing-utils'

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

describe('promoPresetPlan', () => {
    const billing = (over: Record<string, unknown> = {}) => ({
        ...current(over),
        freeUntil: null,
        ...over,
    })

    it('«N месяцев бесплатно» starts where the next paid period would', () => {
        // A trial ending on the 20th: free from then for 2 months.
        const trial = billing({ status: 'TRIAL', trialEndsAt: day('2026-11-20') })
        const plan = promoPresetPlan({ preset: 'FREE_MONTHS', months: 2 }, trial, null, now)
        expect(plan.billing).toEqual({ freeUntil: day('2027-01-20') })
        expect(plan.module).toBeNull()
        expect(plan.summary).toBe('2 мес. бесплатно — до 20.01.2027')

        // A paid period running to the 1st: the next charge moves a month on.
        const active = billing({ currentPeriodEnd: day('2026-12-01') })
        expect(
            promoPresetPlan({ preset: 'FREE_MONTHS', months: 1 }, active, null, now).billing,
        ).toEqual({ freeUntil: day('2027-01-01'), currentPeriodEnd: day('2027-01-01') })

        // Overdue: free from today, and back to ACTIVE.
        const overdue = billing({ status: 'PAST_DUE', currentPeriodEnd: day('2026-11-01') })
        expect(
            promoPresetPlan({ preset: 'FREE_MONTHS', months: 3 }, overdue, null, now).billing,
        ).toEqual({
            freeUntil: new Date('2027-02-10T12:00:00.000Z'),
            status: 'ACTIVE',
            pastDueSince: null,
            currentPeriodEnd: new Date('2027-02-10T12:00:00.000Z'),
        })
    })

    it('«Видео в подарок» comps VIDEO from now, or from the end of a running gift', () => {
        const plan = promoPresetPlan({ preset: 'VIDEO_GIFT', months: 2 }, billing(), null, now)
        expect(plan.billing).toEqual({})
        expect(plan.module).toEqual({
            module: 'VIDEO',
            mode: 'COMP',
            compUntil: new Date('2027-01-10T12:00:00.000Z'),
            customPrice: null,
            cancelAt: null,
        })
        const running = { module: 'VIDEO' as const, mode: 'COMP' as const, compUntil: day('2026-12-01') }
        expect(
            promoPresetPlan({ preset: 'VIDEO_GIFT', months: 1 }, billing(), running, now).module
                ?.compUntil,
        ).toEqual(day('2027-01-01'))
        // A paid VIDEO is turned into the gift from now.
        const paid = { module: 'VIDEO' as const, mode: 'PAID' as const, compUntil: null }
        expect(
            promoPresetPlan({ preset: 'VIDEO_GIFT', months: 1 }, billing(), paid, now).module
                ?.compUntil,
        ).toEqual(new Date('2026-12-10T12:00:00.000Z'))
    })

    it('«Скидка N% на N месяцев» sets the percent and its end', () => {
        const active = billing({ currentPeriodEnd: day('2026-12-01') })
        const plan = promoPresetPlan(
            { preset: 'DISCOUNT', months: 3, discountPercent: 25 },
            active,
            null,
            now,
        )
        expect(plan.billing).toEqual({ discountPercent: 25, discountUntil: day('2027-03-01') })
        expect(plan.summary).toBe('Скидка 25% на 3 мес. — до 01.03.2027')
    })

    it('«Без платы за подключение» waives the setup fee', () => {
        expect(promoPresetPlan({ preset: 'NO_SETUP_FEE' }, billing(), null, now)).toEqual({
            billing: { setupFeeWaived: true },
            module: null,
            summary: 'Без платы за подключение',
        })
    })
})
