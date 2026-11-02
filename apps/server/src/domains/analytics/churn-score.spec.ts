import {
    type ChurnInput,
    type ChurnSubscription,
    churnLevel,
    computeChurnScore,
    monthlySpend,
} from './churn-score'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'

const DAY = 24 * 3600_000
// Monday 2 Nov 2026, 12:00 in Tomsk (UTC+7).
const NOW = new Date('2026-11-02T05:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)
const ahead = (d: number) => new Date(NOW.getTime() + d * DAY)

const base = (over: Partial<ChurnInput> = {}): ChurnInput => ({
    now: NOW,
    tz: 'Asia/Tomsk',
    attendanceActive: true,
    joinedAt: ago(200),
    firstVisitAt: ago(200),
    lastVisitAt: ago(1),
    windowVisits: [],
    frozenUntil: null,
    lastFreezeEndAt: null,
    subscriptions: [],
    missedBookings: 0,
    vocabulary: vocabularyForWorkspaceType('GRAPPLING'),
    ...over,
})

const sub = (over: Partial<ChurnSubscription> = {}): ChurnSubscription => ({
    status: 'ACTIVE',
    startDate: ago(10),
    endDate: ahead(20),
    classesRemaining: null,
    planName: '12 занятий',
    isTrial: false,
    isPaid: true,
    amountPaid: 5000,
    currency: 'RUB',
    createdAt: ago(10),
    ...over,
})

const codes = (i: ChurnInput) => computeChurnScore(i).reasons.map((r) => r.code)
const points = (i: ChurnInput) => computeChurnScore(i).score

describe('computeChurnScore', () => {
    it('scores an empty, fresh member at 0', () => {
        const r = computeChurnScore(
            base({ joinedAt: NOW, firstVisitAt: null, lastVisitAt: null }),
        )
        expect(r).toEqual({ score: 0, level: 'low', reasons: [] })
    })

    it('flags a member who never came only after a week in the club', () => {
        const never = { firstVisitAt: null, lastVisitAt: null }
        expect(points(base({ ...never, joinedAt: ago(6) }))).toBe(0)
        const r = computeChurnScore(base({ ...never, joinedAt: ago(7) }))
        expect(r.score).toBe(20)
        expect(r.reasons[0].text).toBe('В клубе 7 дней, ещё ни разу не был на тренировке')
    })

    it.each([
        [13, 0],
        [14, 16],
        [20, 16],
        [21, 24],
        [30, 32],
        [44, 32],
        [45, 40],
        [120, 40],
    ])('absence of %i days gives %i points', (days, expected) => {
        expect(points(base({ lastVisitAt: ago(days) }))).toBe(expected)
    })

    it('counts a short gap when it is twice the member’s usual one', () => {
        // 3 visits a week before the last 4 weeks → usual gap ~2.3 days.
        const windowVisits = Array.from({ length: 24 }, (_, i) => ago(29 + i * 2))
        const r = computeChurnScore(base({ lastVisitAt: ago(8), windowVisits }))
        expect(r.reasons.find((x) => x.code === 'absent')?.points).toBe(8)
        // Without a baseline the usual gap is a week: 8 days is fine.
        expect(codes(base({ lastVisitAt: ago(8) }))).not.toContain('absent')
    })

    it('counts days in the club timezone, not UTC', () => {
        // Last visit Mon 19 Oct 00:30 Tomsk (= 18 Oct 17:30 UTC); now Sun
        // 1 Nov 23:30 Tomsk (= 16:30 UTC). UTC dates are 14 days apart, the
        // club's calendar only 13: not yet «две недели».
        const r = computeChurnScore(
            base({
                now: new Date('2026-11-01T16:30:00.000Z'),
                lastVisitAt: new Date('2026-10-18T17:30:00.000Z'),
            }),
        )
        expect(r.reasons.map((x) => x.code)).not.toContain('absent')
        const next = computeChurnScore(
            base({
                now: new Date('2026-11-01T17:30:00.000Z'), // Mon 2 Nov 00:30 Tomsk
                lastVisitAt: new Date('2026-10-18T17:30:00.000Z'),
            }),
        )
        expect(next.reasons[0]).toMatchObject({ code: 'absent', points: 16 })
        expect(next.reasons[0].text).toBe('Не был на тренировке 14 дней')
        // A dance studio speaks of classes.
        const studio = computeChurnScore(
            base({
                now: new Date('2026-11-01T17:30:00.000Z'),
                lastVisitAt: new Date('2026-10-18T17:30:00.000Z'),
                vocabulary: vocabularyForWorkspaceType('DANCE'),
            }),
        )
        expect(studio.reasons[0].text).toBe('Не был на занятии 14 дней')
    })

    it('scores a falling trend against the member’s own baseline', () => {
        // 16 visits in the 8 weeks before (2/week), 2 in the last 4 (0.5/week).
        const windowVisits = [
            ...Array.from({ length: 16 }, (_, i) => ago(30 + i * 3)),
            ago(3),
            ago(10),
        ]
        const r = computeChurnScore(base({ lastVisitAt: ago(3), windowVisits }))
        expect(r.reasons).toEqual([
            {
                code: 'declining',
                points: 15,
                text: 'Ходит реже: было ~2 в неделю, стало 0,5',
            },
        ])
    })

    it('ignores a small drop and a thin baseline', () => {
        const steady = [
            ...Array.from({ length: 16 }, (_, i) => ago(30 + i * 3)),
            ...Array.from({ length: 6 }, (_, i) => ago(1 + i * 4)),
        ]
        expect(codes(base({ windowVisits: steady }))).toEqual([])
        const thin = Array.from({ length: 7 }, (_, i) => ago(30 + i * 7))
        expect(codes(base({ lastVisitAt: ago(3), windowVisits: thin }))).toEqual([])
    })

    it('flags an abonement that ended within 30 days and was not renewed', () => {
        const ended = (d: number) =>
            base({ subscriptions: [sub({ endDate: ago(d), startDate: ago(d + 30) })] })
        const r = computeChurnScore(ended(30))
        expect(r.reasons[0]).toMatchObject({ code: 'expired', points: 25 })
        expect(r.reasons[0].text).toMatch(/^Абонемент «12 занятий» закончился \d+ октября и не продлён$/)
        expect(codes(ended(31))).toEqual([])
        // A cancelled sale never "lapsed".
        expect(
            codes(base({ subscriptions: [sub({ status: 'CANCELLED', endDate: ago(3) })] })),
        ).toEqual([])
    })

    it('scores an abonement running out by the days left', () => {
        const ending = (d: number) => base({ subscriptions: [sub({ endDate: ahead(d) })] })
        expect(computeChurnScore(ending(7)).reasons[0]).toMatchObject({
            code: 'ending_soon',
            points: 15,
            text: 'Абонемент «12 занятий» заканчивается через 7 дней, следующий не куплен',
        })
        expect(points(ending(8))).toBe(8)
        expect(points(ending(14))).toBe(8)
        expect(points(ending(15))).toBe(0)
        // The next one already bought (waits for the first visit) covers it.
        expect(
            points(
                base({
                    subscriptions: [
                        sub({ endDate: ahead(3) }),
                        sub({ startDate: null, endDate: null, createdAt: ago(1) }),
                    ],
                }),
            ),
        ).toBe(0)
    })

    it('flags a pack with no classes left unless another live one remains', () => {
        expect(
            computeChurnScore(base({ subscriptions: [sub({ classesRemaining: 0 })] })).reasons[0],
        ).toMatchObject({ code: 'out_of_classes', points: 20 })
        expect(
            codes(
                base({
                    subscriptions: [
                        sub({ classesRemaining: 0 }),
                        sub({ classesRemaining: 4, endDate: ahead(25) }),
                    ],
                }),
            ),
        ).toEqual([])
    })

    it('ignores trial abonements for lapses', () => {
        expect(
            codes(base({ subscriptions: [sub({ isTrial: true, endDate: ago(2) })] })),
        ).toEqual([])
    })

    it('keeps a frozen member low and silences attendance signals', () => {
        const r = computeChurnScore(
            base({
                lastVisitAt: ago(40),
                frozenUntil: new Date('2026-11-20T00:00:00.000Z'),
            }),
        )
        expect(r).toEqual({
            score: 5,
            level: 'low',
            reasons: [{ code: 'frozen', points: 5, text: 'Абонемент заморожен до 20 ноября' }],
        })
    })

    it('counts absence from the end of a freeze and flags not coming back', () => {
        const r = computeChurnScore(
            base({ lastVisitAt: ago(60), lastFreezeEndAt: ago(15) }),
        )
        expect(r.reasons.map((x) => [x.code, x.points])).toEqual([
            ['absent', 16],
            ['after_freeze', 10],
        ])
        expect(r.reasons[0].text).toBe('Не был 15 дней после заморозки')
    })

    it('caps missed bookings at 18 points', () => {
        expect(points(base({ missedBookings: 1 }))).toBe(6)
        expect(points(base({ missedBookings: 4 }))).toBe(18)
    })

    it('flags a newcomer slipping in the first two months', () => {
        const r = computeChurnScore(
            base({ firstVisitAt: ago(20), lastVisitAt: ago(9), windowVisits: [ago(9), ago(20)] }),
        )
        expect(r.reasons).toContainEqual({
            code: 'newcomer',
            points: 12,
            text: 'Новичок: 20 дней в клубе, за 2 недели — 1 визит',
        })
        // Day 13 is too early to judge, day 61 is past the newcomer window.
        expect(codes(base({ firstVisitAt: ago(13), lastVisitAt: ago(13) }))).not.toContain('newcomer')
        expect(codes(base({ firstVisitAt: ago(61), lastVisitAt: ago(5) }))).not.toContain('newcomer')
    })

    it('adds unpaid abonements older than a week as debt', () => {
        const unpaid = (d: number) =>
            base({ subscriptions: [sub({ isPaid: false, amountPaid: 4000, createdAt: ago(d) })] })
        expect(computeChurnScore(unpaid(7)).reasons).toContainEqual({
            code: 'debt',
            points: 10,
            // ru-RU groups thousands with a narrow no-break space.
            text: expect.stringMatching(/^Долг 4\s000 ₽ за «12 занятий»$/),
        })
        expect(codes(unpaid(6))).not.toContain('debt')
    })

    it('takes 10 points off for a year in the club, never below 0', () => {
        const r = computeChurnScore(base({ firstVisitAt: ago(400), missedBookings: 1 }))
        expect(r.score).toBe(0)
        expect(r.reasons.map((x) => x.code)).toEqual(['missed_bookings', 'veteran'])
        // Nothing to discount: no veteran line on its own.
        expect(codes(base({ firstVisitAt: ago(400) }))).toEqual([])
    })

    it('caps the score at 100 and sorts reasons strongest first', () => {
        const r = computeChurnScore(
            base({
                firstVisitAt: ago(50),
                lastVisitAt: ago(46),
                windowVisits: [ago(46), ago(50)],
                subscriptions: [
                    sub({ endDate: ago(5), startDate: ago(35) }),
                    sub({ isPaid: false, createdAt: ago(20), endDate: ago(1) }),
                ],
                missedBookings: 5,
            }),
        )
        expect(r.score).toBe(100)
        expect(r.level).toBe('high')
        expect(r.reasons.map((x) => x.points)).toEqual(
            [...r.reasons.map((x) => x.points)].sort((a, b) => b - a),
        )
    })

    it('switches attendance signals off when the club stopped marking', () => {
        expect(codes(base({ attendanceActive: false, lastVisitAt: ago(60) }))).toEqual([])
    })
})

describe('churnLevel', () => {
    it.each([
        [100, 'high'],
        [60, 'high'],
        [59, 'medium'],
        [35, 'medium'],
        [34, 'low'],
        [0, 'low'],
    ])('%i → %s', (score, level) => {
        expect(churnLevel(score)).toBe(level)
    })
})

describe('monthlySpend', () => {
    const paid = (daysAgo: number, amount = 5000, over = {}) => ({
        isPaid: true,
        isTrial: false,
        amountPaid: amount,
        paidAt: ago(daysAgo),
        createdAt: ago(daysAgo),
        ...over,
    })

    it('is 0 without paid abonements in 180 days', () => {
        expect(monthlySpend(NOW, [])).toBe(0)
        expect(monthlySpend(NOW, [paid(181)])).toBe(0)
        expect(monthlySpend(NOW, [paid(5, 5000, { isPaid: false })])).toBe(0)
        expect(monthlySpend(NOW, [paid(5, 0, { isTrial: true })])).toBe(0)
    })

    it('averages over the months since the first payment in the window', () => {
        expect(monthlySpend(NOW, [paid(10)])).toBe(5000)
        expect(monthlySpend(NOW, [paid(10), paid(40), paid(70)])).toBe(5000)
        expect(monthlySpend(NOW, [paid(10, 6000), paid(170, 3000)])).toBe(1500)
    })

    it('falls back to the sale date for legacy rows', () => {
        expect(monthlySpend(NOW, [paid(10, 4000, { paidAt: null })])).toBe(4000)
    })
})
