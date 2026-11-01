import {
    addMonthsYmd,
    averageRetention,
    buildCohorts,
    type GroupVisitStat,
    mergeVisitSpans,
} from './cohorts'

const TZ = 'Asia/Tomsk'
const span = (userId: string, first: string, last: string) => ({
    userId,
    firstVisitAt: new Date(first),
    lastVisitAt: new Date(last),
    visits: 1,
})

describe('addMonthsYmd', () => {
    it.each([
        ['2026-01-15', 1, '2026-02-15'],
        ['2026-01-31', 1, '2026-02-28'],
        ['2028-01-31', 1, '2028-02-29'],
        ['2026-03-31', 1, '2026-04-30'],
        ['2026-11-30', 2, '2027-01-30'],
        ['2026-08-31', 6, '2027-02-28'],
        ['2026-03-01', -3, '2025-12-01'],
    ])('%s + %i months = %s', (ymd, k, expected) => {
        expect(addMonthsYmd(ymd, k)).toBe(expected)
    })
})

describe('buildCohorts', () => {
    it('is empty without visits', () => {
        expect(buildCohorts([], { now: new Date(), tz: TZ })).toEqual([])
        expect(averageRetention([])).toEqual([
            { offset: 1, rate: null, eligible: 0 },
            { offset: 2, rate: null, eligible: 0 },
            { offset: 3, rate: null, eligible: 0 },
            { offset: 6, rate: null, eligible: 0 },
        ])
    })

    it('buckets by the club-local month of the first visit', () => {
        // 31 Jan 18:00 UTC is already 1 Feb 01:00 in Tomsk.
        const now = new Date('2026-09-15T05:00:00.000Z')
        const cohorts = buildCohorts(
            [
                span('a', '2026-01-31T18:00:00.000Z', '2026-09-01T10:00:00.000Z'),
                span('b', '2026-01-31T16:00:00.000Z', '2026-02-01T10:00:00.000Z'),
            ],
            { now, tz: TZ },
        )
        expect(cohorts.map((c) => [c.month, c.size])).toEqual([
            ['2026-01', 1],
            ['2026-02', 1],
        ])
    })

    it('counts a member retained at k months when they came on/after the k-month date', () => {
        const now = new Date('2026-09-15T05:00:00.000Z')
        // First visit 31 Jan (Tomsk); the 1-month date is 28 Feb.
        const [jan] = buildCohorts(
            [
                span('stays', '2026-01-31T03:00:00.000Z', '2026-02-28T03:00:00.000Z'),
                span('leaves', '2026-01-31T03:00:00.000Z', '2026-02-27T03:00:00.000Z'),
            ],
            { now, tz: TZ },
        )
        expect(jan.cells[0]).toEqual({
            offset: 1,
            eligible: 2,
            retained: 1,
            rate: 0.5,
            partial: false,
        })
        expect(jan.cells[1]).toMatchObject({ offset: 2, retained: 0, rate: 0 })
    })

    it('leaves cells the cohort has not reached empty and flags partly grown ones', () => {
        // Today in Tomsk: 15 Oct 2026.
        const now = new Date('2026-10-15T05:00:00.000Z')
        const [sep] = buildCohorts(
            [
                span('early', '2026-09-10T03:00:00.000Z', '2026-10-14T03:00:00.000Z'),
                span('late', '2026-09-20T03:00:00.000Z', '2026-10-14T03:00:00.000Z'),
            ],
            { now, tz: TZ },
        )
        expect(sep.cells[0]).toEqual({
            offset: 1,
            eligible: 1,
            retained: 1,
            rate: 1,
            partial: true,
        })
        expect(sep.cells[1]).toEqual({
            offset: 2,
            eligible: 0,
            retained: 0,
            rate: null,
            partial: false,
        })
    })

    it('keeps the last 12 months and averages the mature cells', () => {
        const now = new Date('2026-10-15T05:00:00.000Z')
        const cohorts = buildCohorts(
            [
                span('old', '2025-10-31T03:00:00.000Z', '2026-10-01T03:00:00.000Z'),
                span('a', '2025-11-05T03:00:00.000Z', '2026-01-01T03:00:00.000Z'),
                span('b', '2026-03-05T03:00:00.000Z', '2026-03-06T03:00:00.000Z'),
            ],
            { now, tz: TZ },
        )
        expect(cohorts.map((c) => c.month)).toEqual(['2025-11', '2026-03'])
        expect(averageRetention(cohorts)[0]).toEqual({ offset: 1, rate: 0.5, eligible: 2 })
    })
})

describe('mergeVisitSpans', () => {
    const stats: GroupVisitStat[] = [
        { userId: 'u', groupId: 'g1', firstVisitAt: new Date('2026-03-01'), lastVisitAt: new Date('2026-04-01'), visits: 3 },
        { userId: 'u', groupId: 'g2', firstVisitAt: new Date('2026-02-01'), lastVisitAt: new Date('2026-03-01'), visits: 2 },
        { userId: 'u', groupId: null, firstVisitAt: new Date('2026-01-01'), lastVisitAt: new Date('2026-05-01'), visits: 1 },
        { userId: 'v', groupId: 'g2', firstVisitAt: new Date('2026-02-10'), lastVisitAt: new Date('2026-02-11'), visits: 2 },
    ]

    it('spans every group and group-less visits for the whole club', () => {
        expect(mergeVisitSpans(stats, null, true)).toEqual([
            { userId: 'u', firstVisitAt: new Date('2026-01-01'), lastVisitAt: new Date('2026-05-01'), visits: 6 },
            { userId: 'v', firstVisitAt: new Date('2026-02-10'), lastVisitAt: new Date('2026-02-11'), visits: 2 },
        ])
    })

    it('narrows to the allowed groups and drops group-less visits', () => {
        expect(mergeVisitSpans(stats, new Set(['g1']), false)).toEqual([
            { userId: 'u', firstVisitAt: new Date('2026-03-01'), lastVisitAt: new Date('2026-04-01'), visits: 3 },
        ])
        expect(mergeVisitSpans(stats, new Set(), false)).toEqual([])
    })
})
