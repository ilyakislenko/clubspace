import {
    attributeRevenue,
    computeLines,
    countedClasses,
    marksBySubscription,
    monthBounds,
    type PayrollClass,
    type PayrollRateRow,
    type PayrollSessionFact,
    rateFor,
    splitByWeights,
} from './payroll-rules'

const MONTH = '2026-11'
// 2026-11-03 is a Tuesday (ISO 2).
const TUE = '2026-11-03'

const session = (over: Partial<PayrollSessionFact> = {}): PayrollSessionFact => ({
    id: 's1',
    groupId: 'g1',
    groupName: 'Утро',
    groupCoachIds: ['coach-a'],
    groupPrimaryCoachId: 'coach-a',
    scheduledSlotId: 'slot-tue',
    sessionDate: TUE,
    startAt: new Date(`${TUE}T16:00:00Z`),
    isPersonal: false,
    workspaceEventId: null,
    coachId: 'coach-a',
    records: [
        { userId: 'm1', usedSubscriptionId: 'sub-1' },
        { userId: 'm2', usedSubscriptionId: null },
    ],
    ...over,
})

const cls = (over: Partial<PayrollClass> = {}): PayrollClass => ({
    sessionId: 's1',
    date: TUE,
    startAt: new Date(`${TUE}T16:00:00Z`),
    groupId: 'g1',
    groupName: 'Утро',
    groupCoachIds: ['coach-a'],
    groupPrimaryCoachId: 'coach-a',
    coachId: 'coach-a',
    marks: 2,
    subscriptionIds: [],
    ...over,
})

const rate = (over: Partial<PayrollRateRow> = {}): PayrollRateRow => ({
    coachId: 'coach-a',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    fixedMonthly: 0,
    perClass: 0,
    perClassMinStudents: 1,
    perStudent: 0,
    revenueBp: 0,
    currency: 'RUB',
    ...over,
})

const lineInput = (over: Partial<Parameters<typeof computeLines>[0]> = {}) => ({
    month: MONTH,
    currency: 'RUB',
    classes: [],
    rates: [],
    adjustments: [],
    revenueByCoach: new Map<string, number>(),
    staffIds: new Set(['coach-a', 'coach-b']),
    names: new Map([
        ['coach-a', 'Анна'],
        ['coach-b', 'Борис'],
    ]),
    fallbackName: 'Бывший сотрудник',
    ...over,
})

describe('monthBounds', () => {
    it('is club-local midnight of the 1st in Asia/Vladivostok (UTC+10)', () => {
        const { start, end } = monthBounds('2026-11', 'Asia/Vladivostok')
        expect(start.toISOString()).toBe('2026-10-31T14:00:00.000Z')
        expect(end.toISOString()).toBe('2026-11-30T14:00:00.000Z')
    })

    it('is club-local midnight of the 1st in Europe/Kaliningrad (UTC+2), across a year', () => {
        const { start, end } = monthBounds('2026-12', 'Europe/Kaliningrad')
        expect(start.toISOString()).toBe('2026-11-30T22:00:00.000Z')
        expect(end.toISOString()).toBe('2026-12-31T22:00:00.000Z')
    })
})

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`)

describe('countedClasses', () => {
    it('counts a scheduled group class of the month', () => {
        const { counted, cancelled } = countedClasses(MONTH, [session()], [])
        expect(counted).toHaveLength(1)
        expect(counted[0]).toMatchObject({ sessionId: 's1', coachId: 'coach-a', marks: 2 })
        expect(counted[0].subscriptionIds).toEqual(['sub-1'])
        expect(cancelled).toEqual([])
    })

    it('leaves out personal, event and groupless sessions and other months', () => {
        const { counted, cancelled } = countedClasses(
            MONTH,
            [
                session({ id: 'p', isPersonal: true }),
                session({ id: 'e', workspaceEventId: 'ev' }),
                session({ id: 'n', groupId: null }),
                session({ id: 'o', sessionDate: '2026-10-27' }),
            ],
            [],
        )
        expect(counted).toEqual([])
        expect(cancelled).toEqual([])
    })

    it('moves a class cancelled after the roster was opened to cancelled', () => {
        const late = { groupId: 'g1', slotId: null, fromDate: day(TUE), untilDate: day(TUE) }
        const { counted, cancelled } = countedClasses(MONTH, [session()], [late])
        expect(counted).toEqual([])
        expect(cancelled.map((c) => c.sessionId)).toEqual(['s1'])
    })

    it("ignores another group's or another slot's cancellation", () => {
        const other = { groupId: 'g2', slotId: null, fromDate: day(TUE), untilDate: day(TUE) }
        const otherSlot = { groupId: 'g1', slotId: 'slot-thu', fromDate: day(TUE), untilDate: day(TUE) }
        expect(countedClasses(MONTH, [session()], [other, otherSlot]).counted).toHaveLength(1)
    })

    it('slot weekday or range changed after the class → still counted', () => {
        // Only the cancellations decide: the slot itself is not re-read, so
        // moving it to Thursday (or retiring it) later keeps the held class.
        expect(countedClasses(MONTH, [session()], []).counted.map((c) => c.sessionId)).toEqual(['s1'])
    })

    it('a deleted slot does not resurrect a class the group cancelled after attendance', () => {
        const groupWide = { groupId: 'g1', slotId: null, fromDate: day(TUE), untilDate: day(TUE) }
        // slotId went null with the slot; the occurrence key keeps it.
        const { counted, cancelled } = countedClasses(MONTH, [session({ scheduledSlotId: 'slot-gone' })], [groupWide])
        expect(counted).toEqual([])
        expect(cancelled.map((c) => c.sessionId)).toEqual(['s1'])
        expect(countedClasses(MONTH, [session({ scheduledSlotId: 'slot-gone' })], []).counted).toHaveLength(1)
    })

    it('counts a moved class once, on its one-off slot', () => {
        // The move cancels the origin Tuesday; the class runs Thursday on a one-off slot.
        const moved = { groupId: 'g1', slotId: 'slot-tue', fromDate: day(TUE), untilDate: day(TUE) }
        const { counted, cancelled } = countedClasses(
            MONTH,
            [
                session({ id: 'origin' }),
                session({ id: 'moved', scheduledSlotId: 'slot-once', sessionDate: '2026-11-05', startAt: new Date('2026-11-05T16:00:00Z') }),
            ],
            [moved],
        )
        expect(counted.map((c) => c.sessionId)).toEqual(['moved'])
        expect(cancelled.map((c) => c.sessionId)).toEqual(['origin'])
    })

    it('credits the substitute (session.coachId) and keeps a null coach', () => {
        const { counted } = countedClasses(
            MONTH,
            [session({ id: 'sub', coachId: 'coach-b' }), session({ id: 'gone', coachId: null, startAt: new Date('2026-11-03T18:00:00Z') })],
            [],
        )
        expect(counted.map((c) => [c.sessionId, c.coachId])).toEqual([
            ['sub', 'coach-b'],
            ['gone', null],
        ])
    })

    it("excludes the coach's own mark and counts guests", () => {
        const { counted } = countedClasses(
            MONTH,
            [
                session({
                    records: [
                        { userId: 'coach-a', usedSubscriptionId: 'own-sub' },
                        { userId: 'guest', usedSubscriptionId: null },
                    ],
                }),
            ],
            [],
        )
        expect(counted[0].marks).toBe(1)
        expect(counted[0].subscriptionIds).toEqual([])
    })

    it('counts an ad-hoc class, whatever the group cancelled', () => {
        const groupWide = { groupId: 'g1', slotId: null, fromDate: day(TUE), untilDate: day(TUE) }
        expect(countedClasses(MONTH, [session({ scheduledSlotId: null })], [groupWide]).counted).toHaveLength(1)
    })
})

describe('rateFor', () => {
    const rates = [
        rate({ effectiveFrom: new Date('2026-09-01T00:00:00Z'), perClass: 1 }),
        rate({ effectiveFrom: new Date('2026-11-01T00:00:00Z'), perClass: 2 }),
        rate({ effectiveFrom: new Date('2026-12-01T00:00:00Z'), perClass: 3 }),
    ]

    it('takes the latest rate from the month or earlier', () => {
        expect(rateFor(rates, '2026-11')?.perClass).toBe(2)
        expect(rateFor(rates, '2026-10')?.perClass).toBe(1)
        expect(rateFor(rates, '2027-03')?.perClass).toBe(3)
    })

    it('is null before the first rate', () => {
        expect(rateFor(rates, '2026-08')).toBeNull()
    })
})

describe('splitByWeights', () => {
    it('sums exactly to the amount (largest remainder)', () => {
        const parts = splitByWeights(100, [
            ['a', 1],
            ['b', 1],
            ['c', 1],
        ])
        expect([...parts.values()].reduce((s, v) => s + v, 0)).toBe(100)
        // The leftover unit goes to the smallest key on a tie.
        expect(parts.get('a')).toBe(34)
        expect(parts.get('b')).toBe(33)
    })

    it('splits a negative amount symmetrically', () => {
        const parts = splitByWeights(-1000, [
            ['a', 2],
            ['b', 1],
        ])
        expect(parts.get('a')).toBe(-667)
        expect(parts.get('b')).toBe(-333)
    })

    it('returns nothing for zero weights', () => {
        expect(splitByWeights(10, [['a', 0]]).size).toBe(0)
    })
})

describe('attributeRevenue', () => {
    const marks = marksBySubscription([
        cls({ sessionId: 'x1', coachId: 'coach-a', subscriptionIds: ['sub-1'] }),
        cls({ sessionId: 'x2', coachId: 'coach-a', subscriptionIds: ['sub-1'] }),
        cls({ sessionId: 'x3', coachId: 'coach-b', subscriptionIds: ['sub-1'] }),
        // A class without a coach credits nobody.
        cls({ sessionId: 'x4', coachId: null, subscriptionIds: ['sub-2'] }),
    ])

    it('splits a sale by visits across two coaches', () => {
        const r = attributeRevenue(
            [{ subscriptionId: 'sub-1', userId: 'm1', amount: 3000, currency: 'RUB' }],
            marks,
            new Map(),
            'RUB',
        )
        expect(r.byCoach.get('coach-a')).toBe(2000)
        expect(r.byCoach.get('coach-b')).toBe(1000)
        expect(r.unattributed).toBe(0)
    })

    it('falls back to an equal split between the holder’s group coaches', () => {
        const r = attributeRevenue(
            [{ subscriptionId: 'sub-new', userId: 'm2', amount: 1001, currency: 'RUB' }],
            marks,
            new Map([['m2', ['coach-a', 'coach-b', 'coach-a']]]),
            'RUB',
        )
        expect(r.byCoach.get('coach-a')).toBe(501)
        expect(r.byCoach.get('coach-b')).toBe(500)
    })

    it('subtracts a refund the same way and leaves the rest unattributed', () => {
        const r = attributeRevenue(
            [
                { subscriptionId: 'sub-1', userId: 'm1', amount: -300, currency: 'RUB' },
                { subscriptionId: 'sub-2', userId: 'm9', amount: 4500, currency: 'RUB' },
                { subscriptionId: 'sub-3', userId: null, amount: -100, currency: 'RUB' },
            ],
            marks,
            new Map(),
            'RUB',
        )
        expect(r.byCoach.get('coach-a')).toBe(-200)
        expect(r.byCoach.get('coach-b')).toBe(-100)
        expect(r.unattributed).toBe(4400)
    })

    it('counts rows in another currency apart', () => {
        const r = attributeRevenue(
            [{ subscriptionId: 'sub-1', userId: 'm1', amount: 50, currency: 'USD' }],
            marks,
            new Map(),
            'RUB',
        )
        expect(r.otherCurrency).toBe(1)
        expect(r.byCoach.size).toBe(0)
    })
})

describe('computeLines', () => {
    it('pays every part of a rate', () => {
        const [line] = computeLines(
            lineInput({
                classes: [
                    cls({ sessionId: 'a', marks: 3 }),
                    cls({ sessionId: 'b', marks: 5 }),
                    cls({ sessionId: 'c', marks: 2 }),
                ],
                rates: [
                    rate({
                        fixedMonthly: 30000,
                        perClass: 1500,
                        perClassMinStudents: 3,
                        perStudent: 100,
                        revenueBp: 1000,
                    }),
                ],
                revenueByCoach: new Map([['coach-a', 84005]]),
                adjustments: [
                    { id: 'adj', coachId: 'coach-a', amount: 5000, currency: 'RUB', comment: 'Открытый урок', createdAt: new Date(), createdByName: 'Ольга' },
                ],
            }),
        )
        expect(line).toMatchObject({
            classes: 3,
            classesPaid: 2,
            marks: 10,
            marksPaid: 8,
            revenueBase: 84005,
            amounts: { fixed: 30000, classes: 3000, students: 800, revenue: 8401, adjustments: 5000 },
            total: 30000 + 3000 + 800 + 8401 + 5000,
        })
        expect(line.rate).toMatchObject({ effectiveFrom: '2026-01', perClass: 1500 })
        expect(line.ignoredRate).toBeNull()
    })

    it.each([
        [0, 3],
        [1, 2],
        [3, 1],
    ])('threshold %i pays %i of the classes', (min, paid) => {
        const [line] = computeLines(
            lineInput({
                classes: [cls({ sessionId: 'z', marks: 0 }), cls({ sessionId: 'o', marks: 1 }), cls({ sessionId: 't', marks: 3 })],
                rates: [rate({ perClass: 100, perClassMinStudents: min })],
            }),
        )
        expect(line.classesPaid).toBe(paid)
        expect(line.amounts.classes).toBe(paid * 100)
    })

    it('shows counts and zero without a rate; only an adjustment goes negative', () => {
        const [line] = computeLines(
            lineInput({
                classes: [cls({ coachId: 'coach-b' })],
                adjustments: [
                    { id: 'd', coachId: 'coach-b', amount: -700, currency: 'RUB', comment: 'Удержание', createdAt: new Date(), createdByName: 'О' },
                ],
                revenueByCoach: new Map([['coach-b', -5000]]),
            }),
        )
        expect(line).toMatchObject({ coachId: 'coach-b', rate: null, classes: 1, total: -700 })
        expect(line.amounts).toEqual({ fixed: 0, classes: 0, students: 0, revenue: 0, adjustments: -700 })
    })

    it('never pays a negative percent', () => {
        const [line] = computeLines(
            lineInput({
                rates: [rate({ revenueBp: 1000 })],
                revenueByCoach: new Map([['coach-a', -3000]]),
            }),
        )
        expect(line.amounts.revenue).toBe(0)
    })

    it('rows: staff with a rate in force, anyone with a class or adjustment; sorted by name', () => {
        const lines = computeLines(
            lineInput({
                classes: [cls({ coachId: 'gone' })],
                rates: [
                    rate({ coachId: 'coach-b', fixedMonthly: 1 }),
                    // Not on staff any more: a rate alone makes no row.
                    rate({ coachId: 'former', fixedMonthly: 1 }),
                    // From next month: not in force.
                    rate({ coachId: 'coach-a', effectiveFrom: new Date('2026-12-01T00:00:00Z') }),
                ],
            }),
        )
        expect(lines.map((l) => [l.coachId, l.name])).toEqual([
            ['coach-b', 'Борис'],
            ['gone', 'Бывший сотрудник'],
        ])
    })

    it('ignores and flags a rate and an adjustment in another currency than the month’s', () => {
        const [line] = computeLines(
            lineInput({
                classes: [cls({ marks: 3 })],
                rates: [rate({ fixedMonthly: 30000, perClass: 1500, currency: 'KZT' })],
                adjustments: [
                    { id: 'k', coachId: 'coach-a', amount: 9000, currency: 'KZT', comment: 'Премия', createdAt: new Date(), createdByName: 'О' },
                    { id: 'r', coachId: 'coach-a', amount: 500, currency: 'RUB', comment: 'Премия', createdAt: new Date(), createdByName: 'О' },
                ],
            }),
        )
        expect(line.rate).toBeNull()
        expect(line.ignoredRate).toMatchObject({ currency: 'KZT', perClass: 1500 })
        expect(line.amounts).toEqual({ fixed: 0, classes: 0, students: 0, revenue: 0, adjustments: 500 })
        expect(line.total).toBe(500)
        // Still a row for a staff member whose only rate is in another currency.
        const [rateOnly] = computeLines(lineInput({ rates: [rate({ coachId: 'coach-b', fixedMonthly: 1, currency: 'KZT' })] }))
        expect(rateOnly).toMatchObject({ coachId: 'coach-b', total: 0, ignoredRate: { currency: 'KZT' } })
    })
})
