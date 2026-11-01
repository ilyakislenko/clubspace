import type {
    ChurnEntry,
    ChurnReport,
    CohortReport,
    ForecastReport,
    OccupancyReport,
    OccupancySlot,
} from './analytics-reports'
import { analyticsDigestSlot, buildWeeklyDigest } from './digest-rules'

describe('analyticsDigestSlot', () => {
    it('is due on Monday 09:00-09:59 club time only', () => {
        // Mon 2 Nov 2026 09:15 in Tomsk = 02:15 UTC.
        expect(analyticsDigestSlot(new Date('2026-11-02T02:15:00Z'), 'Asia/Tomsk')).toEqual({
            due: true,
            weekYmd: '2026-11-02',
        })
        expect(analyticsDigestSlot(new Date('2026-11-02T03:00:00Z'), 'Asia/Tomsk').due).toBe(false)
        expect(analyticsDigestSlot(new Date('2026-11-02T01:59:00Z'), 'Asia/Tomsk').due).toBe(false)
        // Sunday 23:30 UTC is already Monday in Vladivostok (UTC+10) — 09:30.
        expect(
            analyticsDigestSlot(new Date('2026-11-01T23:30:00Z'), 'Asia/Vladivostok'),
        ).toEqual({ due: true, weekYmd: '2026-11-02' })
        // A Tuesday 09:00 is not.
        expect(analyticsDigestSlot(new Date('2026-11-03T06:00:00Z'), 'Europe/Moscow').due).toBe(false)
    })
})

const entry = (over: Partial<ChurnEntry>): ChurnEntry => ({
    userId: 'u',
    firstname: 'Иван',
    lastname: 'Петров',
    email: null,
    phone: null,
    guardians: [],
    groups: [],
    score: 70,
    level: 'high',
    reasons: [{ code: 'expired', points: 25, text: 'Абонемент закончился' }],
    monthlySpend: 5000,
    currency: 'RUB',
    lastVisitAt: null,
    lastContact: null,
    contactedRecently: false,
    ...over,
})

const slot = (over: Partial<OccupancySlot>): OccupancySlot => ({
    slotId: 's',
    groupId: 'g',
    gymId: null,
    dayOfWeek: 1,
    startTime: '19:00',
    scheduled: 8,
    held: 8,
    avgAttendance: 19,
    capacity: 20,
    fill: 0.95,
    booked: 0,
    missedBookings: 0,
    groupName: 'BJJ вечер',
    gymName: null,
    directionId: null,
    ...over,
})

const reports = (over: {
    entries?: ChurnEntry[]
    occupancy?: Partial<OccupancyReport>
    trial?: ForecastReport['trial']
    cohorts?: CohortReport['cohorts']
}) => {
    const entries = over.entries ?? []
    const open = entries.filter((e) => !e.contactedRecently)
    const churn: ChurnReport = {
        computedAt: null,
        entries,
        summary: {
            total: open.length,
            high: open.filter((e) => e.level === 'high').length,
            medium: 0,
            moneyAtStake: open.reduce((s, e) => s + e.monthlySpend, 0),
            currency: 'RUB',
            contactedRecently: entries.length - open.length,
        },
    }
    const forecast: ForecastReport = {
        computedAt: null,
        currency: 'RUB',
        members: 40,
        monthlyRecurring: 200000,
        horizons: [
            { days: 30, potential: 100000, expected: 70000, atRisk: 30000 },
            { days: 90, potential: 300000, expected: 180000, atRisk: 120000 },
        ],
        renewal: { clubRate: 0.7, clubSample: 0, scopeRate: null, scopeSample: 0, usesDefault: true },
        highRiskMoney: 0,
        trial: over.trial ?? { trials: 0, converted: 0, rate: null, medianDaysToPay: null },
    }
    const occupancy: OccupancyReport = {
        computedAt: null,
        weeks: 8,
        slots: [],
        heatmap: [],
        weakest: [],
        strongest: [],
        suggestions: [],
        ...over.occupancy,
    }
    const cohorts: CohortReport = { computedAt: null, cohorts: over.cohorts ?? [], average: [] }
    return { churn, forecast, occupancy, cohorts }
}

const nbsp = (s: string) => s.replace(/\s/g, ' ')

describe('buildWeeklyDigest', () => {
    it('gives a quiet club its facts and generic actions', () => {
        const d = buildWeeklyDigest(reports({}))
        expect(d.facts.map(nbsp)).toEqual([
            'Под риском ухода никого — ученики ходят стабильно',
            'Прогноз продлений на 30 дней: 70 000 ₽ из 100 000 ₽ возможных (продлевают 70%)',
            'Активных учеников: 40, вместе они платят 200 000 ₽ в месяц',
        ])
        expect(d.actions.map((a) => a.path)).toEqual(['analytics/cohorts', 'analytics/coaches'])
    })

    it('picks three facts and three concrete actions by priority', () => {
        const d = buildWeeklyDigest(
            reports({
                entries: [
                    entry({ userId: 'a', firstname: 'Анна', lastname: null }),
                    entry({ userId: 'b', firstname: 'Борис', lastname: null, reasons: [] }),
                    entry({ userId: 'c', firstname: 'Вера', lastname: null, contactedRecently: true }),
                ],
                occupancy: {
                    strongest: [slot({})],
                    suggestions: [
                        { kind: 'rethink_slot', slotId: 'w', text: 'Слабый слот' },
                        { kind: 'add_class', slotId: 's', text: 'Добавьте занятие' },
                    ],
                },
                cohorts: [
                    {
                        month: '2026-08',
                        size: 10,
                        cells: [{ offset: 1, eligible: 10, retained: 8, rate: 0.8, partial: false }],
                    },
                ],
            }),
        )
        expect(d.facts.map(nbsp)).toEqual([
            '2 ученика под риском ухода (высокий риск — 2), на кону 10 000 ₽ в месяц',
            'Прогноз продлений на 30 дней: 70 000 ₽ из 100 000 ₽ возможных (продлевают 70%)',
            'Из пришедших впервые в августе через месяц ходят 80% (8 из 10)',
        ])
        expect(d.actions.map((a) => [nbsp(a.text), a.path])).toEqual([
            ['Позвоните сегодня: Анна, Борис — на кону 10 000 ₽ в месяц', 'analytics/churn'],
            ['Предложите продление 1 ученику: абонемент закончился или заканчивается', 'analytics/churn'],
            ['Добавьте занятие', 'analytics/occupancy'],
        ])
    })

    it('nudges about trials that do not convert', () => {
        const d = buildWeeklyDigest(
            reports({ trial: { trials: 10, converted: 3, rate: 0.3, medianDaysToPay: 4 } }),
        )
        expect(d.facts).toContain('Пробные: абонемент купили 3 из 10 (30%), обычно через 4 дня')
        expect(d.actions[0]).toEqual({
            text: 'Пробные покупают абонемент в 30% случаев — позвоните тем, кто был на пробном и не купил',
            path: 'analytics/forecast',
        })
    })
})
