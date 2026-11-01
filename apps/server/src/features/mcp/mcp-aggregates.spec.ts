import {
    abonementState,
    aggregateAttendance,
    CLUB_WIDE_KEY,
    groupRevenue,
    type RevenueRow,
} from './mcp-aggregates'

const TZ = 'Europe/Moscow'
const NOW = new Date('2026-11-15T12:00:00Z')

const sale = (p: Partial<RevenueRow> & { paidAt: string; amountPaid: number }): RevenueRow => ({
    currency: 'RUB',
    createdAt: new Date(p.paidAt),
    planId: 'p8',
    planName: '8 занятий',
    directions: [],
    ...p,
    paidAt: new Date(p.paidAt),
})

describe('groupRevenue', () => {
    const rows = [
        sale({ paidAt: '2026-11-02T10:00:00Z', amountPaid: 4000, directions: [{ id: 'bjj', name: 'БЖЖ' }] }),
        // 23:30 UTC on Oct 31 is already November in Moscow.
        sale({
            paidAt: '2026-10-31T23:30:00Z',
            amountPaid: 5001,
            planId: 'combo',
            planName: 'БЖЖ + ММА',
            directions: [
                { id: 'bjj', name: 'БЖЖ' },
                { id: 'mma', name: 'ММА' },
            ],
        }),
        sale({ paidAt: '2026-10-10T10:00:00Z', amountPaid: 500, planId: 'single', planName: 'Разовое' }),
        sale({ paidAt: '2026-10-11T10:00:00Z', amountPaid: 999, currency: 'USD' }),
    ]
    const base = { currency: 'RUB', now: NOW, tz: TZ, months: 3 }

    it('buckets by club-local month with every month present', () => {
        expect(groupRevenue(rows, { ...base, groupBy: 'month' })).toEqual([
            { key: '2026-09', label: '2026-09', revenue: 0, sales: 0 },
            { key: '2026-10', label: '2026-10', revenue: 500, sales: 1 },
            { key: '2026-11', label: '2026-11', revenue: 9001, sales: 2 },
        ])
    })

    it('groups by tariff, highest revenue first, one currency only', () => {
        expect(groupRevenue(rows, { ...base, groupBy: 'tariff' }).map((b) => [b.label, b.revenue, b.sales])).toEqual([
            ['БЖЖ + ММА', 5001, 1],
            ['8 занятий', 4000, 1],
            ['Разовое', 500, 1],
        ])
    })

    it('splits a multi-direction sale evenly and keeps the club total', () => {
        const buckets = groupRevenue(rows, { ...base, groupBy: 'direction' })
        expect(buckets).toEqual([
            { key: 'bjj', label: 'БЖЖ', revenue: 4000 + 2501, sales: 2 },
            { key: 'mma', label: 'ММА', revenue: 2500, sales: 1 },
            expect.objectContaining({ key: CLUB_WIDE_KEY, revenue: 500, sales: 1 }),
        ])
        expect(buckets.reduce((s, b) => s + b.revenue, 0)).toBe(4000 + 5001 + 500)
    })
})

describe('aggregateAttendance', () => {
    it('totals, per group, per weekday, per week and the top attendees', () => {
        const sessions = [
            // Mon 2026-11-02 and Wed 2026-11-04, Moscow evening.
            { id: 's1', startAt: new Date('2026-11-02T16:00:00Z'), groupId: 'g1', groupName: 'БЖЖ', isPersonal: false },
            { id: 's2', startAt: new Date('2026-11-04T16:00:00Z'), groupId: 'g1', groupName: 'БЖЖ', isPersonal: false },
            { id: 's3', startAt: new Date('2026-11-09T16:00:00Z'), groupId: null, groupName: null, isPersonal: true },
        ]
        const records = [
            { sessionId: 's1', userId: 'a', isGuest: false },
            { sessionId: 's1', userId: 'b', isGuest: true },
            { sessionId: 's2', userId: 'a', isGuest: false },
            { sessionId: 's3', userId: 'a', isGuest: null },
            // A record of a session outside the window is ignored.
            { sessionId: 'other', userId: 'c', isGuest: false },
        ]
        const agg = aggregateAttendance(sessions, records, TZ, 1)
        expect(agg.totals).toEqual({
            sessions: 3,
            checkins: 4,
            distinctAttendees: 2,
            avgPerSession: 1.3,
            guestVisits: 1,
        })
        expect(agg.byGroup).toEqual([
            { groupId: 'g1', name: 'БЖЖ', sessions: 2, checkins: 3, avgPerSession: 1.5 },
            { groupId: null, name: 'Персональные тренировки', sessions: 1, checkins: 1, avgPerSession: 1 },
        ])
        expect(agg.byWeekday.map((d) => [d.label, d.sessions, d.checkins])).toEqual([
            ['Пн', 2, 3],
            ['Ср', 1, 1],
        ])
        expect(agg.byWeek).toEqual([
            { weekStart: '2026-11-02', sessions: 2, checkins: 3 },
            { weekStart: '2026-11-09', sessions: 1, checkins: 1 },
        ])
        expect(agg.topAttendees).toEqual([{ userId: 'a', visits: 3 }])
    })

    it('is all zeros without sessions', () => {
        expect(aggregateAttendance([], [], TZ).totals).toEqual({
            sessions: 0,
            checkins: 0,
            distinctAttendees: 0,
            avgPerSession: 0,
            guestVisits: 0,
        })
    })
})

describe('abonementState', () => {
    const now = new Date('2026-11-15T12:00:00Z')
    const p = { now, todayYmd: '2026-11-15', soon: new Date('2026-11-22T12:00:00Z') }
    const sub = (over: Partial<Parameters<typeof abonementState>[0]> = {}) => ({
        status: 'ACTIVE',
        startDate: new Date('2026-11-01T00:00:00Z'),
        endDate: new Date('2026-12-01T00:00:00Z'),
        classesRemaining: 4,
        freezes: [],
        ...over,
    })

    it.each([
        ['active', sub()],
        ['ended', sub({ endDate: new Date('2026-11-10T00:00:00Z') })],
        ['ended', sub({ status: 'EXPIRED' })],
        [
            'frozen',
            sub({ freezes: [{ fromDate: new Date('2026-11-14T00:00:00Z'), untilDate: new Date('2026-11-20T00:00:00Z') }] }),
        ],
        [
            'active',
            sub({ freezes: [{ fromDate: new Date('2026-11-20T00:00:00Z'), untilDate: new Date('2026-11-25T00:00:00Z') }] }),
        ],
        ['awaiting_first_visit', sub({ startDate: null, endDate: null })],
        ['out_of_classes', sub({ classesRemaining: 0 })],
        ['expiring_soon', sub({ endDate: new Date('2026-11-20T00:00:00Z') })],
    ])('%s', (state, row) => {
        expect(abonementState(row, p)).toBe(state)
    })
})
