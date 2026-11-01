import {
    clubRenewalRate,
    type ForecastSubscription,
    memberForecast,
    memberRenewalProbability,
    renewalHistory,
    trialConversion,
    trialFacts,
} from './forecast'

const DAY = 24 * 3600_000
const NOW = new Date('2026-11-02T05:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)
const ahead = (d: number) => new Date(NOW.getTime() + d * DAY)

let n = 0
const sub = (over: Partial<ForecastSubscription>): ForecastSubscription => ({
    id: `s${n++}`,
    status: 'ACTIVE',
    startDate: ago(20),
    endDate: ahead(10),
    createdAt: ago(20),
    durationDays: 30,
    amountPaid: 5000,
    isTrial: false,
    directionIds: [],
    ...over,
})

describe('renewal probability', () => {
    it('scales the club rate down by the churn score', () => {
        expect(memberRenewalProbability(0.8, 0)).toBe(0.8)
        expect(memberRenewalProbability(0.8, 50)).toBe(0.4)
        expect(memberRenewalProbability(0.8, 100)).toBe(0)
        expect(memberRenewalProbability(0.8, 140)).toBe(0)
    })

    it('uses the default 70% below ten ended abonements', () => {
        expect(clubRenewalRate(0, 0)).toEqual({ rate: null, effective: 0.7 })
        expect(clubRenewalRate(9, 9)).toEqual({ rate: null, effective: 0.7 })
        expect(clubRenewalRate(10, 6)).toEqual({ rate: 0.6, effective: 0.6 })
    })
})

describe('renewalHistory', () => {
    it('is empty without ended abonements', () => {
        expect(renewalHistory(NOW, [])).toEqual({ due: 0, done: 0 })
        expect(renewalHistory(NOW, [sub({})])).toEqual({ due: 0, done: 0 })
    })

    it('counts a renewal bought in advance or within 14 days after the end', () => {
        const ended = sub({ startDate: ago(80), endDate: ago(50), createdAt: ago(80) })
        expect(
            renewalHistory(NOW, [ended, sub({ createdAt: ago(55) })]),
        ).toEqual({ due: 1, done: 1 })
        expect(
            renewalHistory(NOW, [ended, sub({ createdAt: ago(36) })]),
        ).toEqual({ due: 1, done: 1 })
        expect(
            renewalHistory(NOW, [ended, sub({ createdAt: ago(35) })]),
        ).toEqual({ due: 1, done: 0 })
    })

    it('judges only abonements that ended 14-180 days ago, never trials or cancelled ones', () => {
        expect(renewalHistory(NOW, [sub({ endDate: ago(13) })])).toEqual({ due: 0, done: 0 })
        expect(renewalHistory(NOW, [sub({ endDate: ago(14) })])).toEqual({ due: 1, done: 0 })
        expect(renewalHistory(NOW, [sub({ endDate: ago(181) })])).toEqual({ due: 0, done: 0 })
        expect(renewalHistory(NOW, [sub({ endDate: ago(40), isTrial: true })])).toEqual({ due: 0, done: 0 })
        expect(
            renewalHistory(NOW, [sub({ endDate: ago(40), status: 'CANCELLED' })]),
        ).toEqual({ due: 0, done: 0 })
    })
})

describe('memberForecast', () => {
    it('is zero without abonements', () => {
        expect(memberForecast(NOW, [], 0.7)).toEqual({
            potential30: 0,
            expected30: 0,
            potential90: 0,
            expected90: 0,
        })
    })

    it('chains renewals every period with p^k inside the horizon', () => {
        // Ends in 10 days → renewals at +10, +40, +70 days.
        expect(memberForecast(NOW, [sub({})], 0.5)).toEqual({
            potential30: 5000,
            expected30: 2500,
            potential90: 15000,
            expected90: 4375,
        })
    })

    it('starts after an abonement already bought and waiting for its first visit', () => {
        const f = memberForecast(
            NOW,
            [sub({}), sub({ startDate: null, endDate: null, createdAt: ago(2) })],
            1,
        )
        // Coverage runs to +40 days: renewals at +40 and +70 only.
        expect(f).toEqual({ potential30: 0, expected30: 0, potential90: 10000, expected90: 10000 })
    })

    it('expects a lapsed abonement back now, but not after 30 days', () => {
        const lapsed = (d: number) => sub({ startDate: ago(d + 30), endDate: ago(d), createdAt: ago(d + 30) })
        expect(memberForecast(NOW, [lapsed(10)], 0.2).potential30).toBe(5000)
        expect(memberForecast(NOW, [lapsed(10)], 0.2).expected30).toBe(1000)
        expect(memberForecast(NOW, [lapsed(31)], 0.2).potential90).toBe(0)
    })

    it('keeps one stream per scope and skips free and open-ended packs', () => {
        const f = memberForecast(
            NOW,
            [
                sub({}),
                sub({ directionIds: ['muay'], amountPaid: 4500, endDate: ahead(25) }),
                sub({ directionIds: ['bjj'], endDate: null, startDate: ago(3) }),
                sub({ directionIds: ['kids'], amountPaid: 0 }),
            ],
            1,
        )
        expect(f.potential30).toBe(9500)
    })
})

describe('trial conversion', () => {
    it('finds the first trial and the first paid abonement after it', () => {
        expect(trialFacts([])).toEqual({ trialStartedAt: null, trialConvertedAt: null })
        const trial = sub({ isTrial: true, amountPaid: 0, startDate: ago(40), createdAt: ago(41) })
        expect(trialFacts([trial])).toEqual({ trialStartedAt: ago(40), trialConvertedAt: null })
        expect(
            trialFacts([trial, sub({ createdAt: ago(35) }), sub({ createdAt: ago(5) })]),
        ).toEqual({ trialStartedAt: ago(40), trialConvertedAt: ago(35) })
        // A purchase before the trial is not a conversion.
        expect(trialFacts([trial, sub({ createdAt: ago(60) })]).trialConvertedAt).toBeNull()
    })

    it('rates trials 14-180 days old with the median days to pay', () => {
        const row = (started: number, paidAfter: number | null) => ({
            trialStartedAt: ago(started),
            trialConvertedAt: paidAfter === null ? null : ago(started - paidAfter),
        })
        expect(trialConversion(NOW, [])).toEqual({
            trials: 0,
            converted: 0,
            rate: null,
            medianDaysToPay: null,
        })
        expect(
            trialConversion(NOW, [
                row(20, 2),
                row(30, 6),
                row(40, 10),
                row(50, 3),
                row(60, null),
                row(10, 1), // too fresh
                row(200, 1), // too old
                { trialStartedAt: null, trialConvertedAt: null },
            ]),
        ).toEqual({ trials: 5, converted: 4, rate: 0.8, medianDaysToPay: 5 })
    })
})
