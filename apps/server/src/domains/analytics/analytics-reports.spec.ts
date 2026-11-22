import {
    loadCoachReport,
    loadCohortReport,
    loadForecastReport,
    loadOccupancyReport,
} from './analytics-reports'
import { averageRetention, buildCohorts, type GroupVisitStat, mergeVisitSpans } from './cohorts'

const DAY = 24 * 3600_000
const NOW = new Date('2026-11-02T05:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)
const RUN = { historyComputedAt: ago(0.2), riskComputedAt: ago(0.1), clubRenewalRate: 0.6, renewalSample: 20 }
const WHOLE = { groupIds: null, includeGroupless: true }
const ONLY_G1 = { groupIds: new Set(['g1']), includeGroupless: false }

const snapshot = (userId: string, over: Record<string, unknown> = {}) => ({
    workspaceId: 'ws',
    userId,
    score: 70,
    reasons: [
        { code: 'absent', points: 40, text: 'Не был 50 дней' },
        { code: 'bogus', points: 1, text: 'dropped' },
    ],
    monthlySpend: 5000,
    currency: 'RUB',
    groupIds: ['g1'],
    firstVisitAt: ago(200),
    lastVisitAt: ago(50),
    renewalProbability: 0.2,
    potential30: 5000,
    expected30: 1000,
    potential90: 15000,
    expected90: 2000,
    renewalsDue: 4,
    renewalsDone: 2,
    trialStartedAt: null,
    trialConvertedAt: null,
    computedAt: NOW,
    ...over,
})

const makePrisma = () => ({
    analyticsRun: { findUnique: jest.fn().mockResolvedValue(RUN) },
    analyticsMemberSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    analyticsFormerMember: { findMany: jest.fn().mockResolvedValue([]) },
    analyticsMemberGroupStat: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
    },
    analyticsSlotOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk', ownerId: 'owner' }),
    },
    workspaceMember: { count: jest.fn().mockResolvedValue(0) },
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    group: { findMany: jest.fn().mockResolvedValue([]) },
    groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    classSubstitution: { findMany: jest.fn().mockResolvedValue([]) },
})

// Prisma's where/having over AnalyticsMemberGroupStat rows, for the shapes
// the reports send (workspaceId, groupId in / not null / null, OR; _min).
type StatWhere = Record<string, unknown> & { OR?: StatWhere[] }
const matchesGroup = (groupId: string | null, cond: unknown): boolean => {
    if (cond === null) return groupId === null
    const c = cond as { in?: string[]; not?: null }
    if (c.in) return groupId !== null && c.in.includes(groupId)
    if ('not' in c) return groupId !== null
    throw new Error(`unexpected groupId condition ${JSON.stringify(cond)}`)
}
const matchesStat = (row: GroupVisitStat & { workspaceId: string }, where: StatWhere): boolean =>
    (where.workspaceId === undefined || where.workspaceId === row.workspaceId) &&
    (!('groupId' in where) || matchesGroup(row.groupId, where.groupId)) &&
    (!where.OR || where.OR.some((w) => matchesStat(row, w)))
const groupStatsBy = (rows: GroupVisitStat[]) =>
    jest.fn(async (args: { where: StatWhere; having: { firstVisitAt: { _min: { gte: Date } } } }) => {
        const byUser = new Map<string, GroupVisitStat[]>()
        for (const r of rows.filter((r) => matchesStat({ ...r, workspaceId: 'ws' }, args.where))) {
            byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])
        }
        return [...byUser].flatMap(([userId, list]) => {
            const first = new Date(Math.min(...list.map((r) => r.firstVisitAt.getTime())))
            if (first < args.having.firstVisitAt._min.gte) return []
            return [
                {
                    userId,
                    _min: { firstVisitAt: first },
                    _max: { lastVisitAt: new Date(Math.max(...list.map((r) => r.lastVisitAt.getTime()))) },
                    _sum: { visits: list.reduce((s, r) => s + r.visits, 0) },
                },
            ]
        })
    })

describe('loadCohortReport', () => {
    const stat = (userId: string, groupId: string | null, first: number, last: number): GroupVisitStat => ({
        userId,
        groupId,
        firstVisitAt: ago(first),
        lastVisitAt: ago(last),
        visits: 3,
    })

    it('merges the visits of the scope’s groups into cohorts', async () => {
        const prisma = makePrisma()
        prisma.analyticsMemberGroupStat.groupBy = groupStatsBy([
            stat('a', 'g1', 100, 5),
            stat('a', null, 300, 299),
            stat('b', 'g2', 100, 90),
        ])
        const r = await loadCohortReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })
        expect(r.cohorts).toHaveLength(1)
        expect(r.cohorts[0]).toMatchObject({ size: 1 })
        expect(r.average[0]).toEqual({ offset: 1, rate: 1, eligible: 1 })
        expect(r.computedAt).toBe(RUN.historyComputedAt)
    })

    it('gives the numbers of the per-member merge for every kind of scope', async () => {
        // First visits from 3 years ago to today, in and out of the window,
        // with group-less visits that move a member's first visit earlier.
        const rows: GroupVisitStat[] = []
        const groups = ['g1', 'g2', 'g3', null]
        for (let i = 0; i < 160; i++) {
            const first = (i * 7) % 1100
            rows.push(stat(`u${i}`, groups[i % 4], first, Math.max(0, first - ((i * 13) % 400))))
            if (i % 3 === 0) rows.push(stat(`u${i}`, groups[(i + 1) % 4], first + 40, first))
        }
        const scopes = [
            WHOLE,
            { groupIds: null, includeGroupless: false },
            ONLY_G1,
            { groupIds: new Set(['g1', 'g3']), includeGroupless: true },
            { groupIds: new Set<string>(), includeGroupless: false },
        ]
        for (const scope of scopes) {
            const prisma = makePrisma()
            prisma.analyticsMemberGroupStat.groupBy = groupStatsBy(rows)
            const r = await loadCohortReport(prisma as never, { workspaceId: 'ws', scope, now: NOW })
            const expected = buildCohorts(mergeVisitSpans(rows, scope.groupIds, scope.includeGroupless), {
                now: NOW,
                tz: 'Asia/Tomsk',
            })
            expect(r.cohorts).toEqual(expected)
            expect(r.average).toEqual(averageRetention(expected))
        }
    })
})

describe('loadOccupancyReport', () => {
    const occ = (slotId: string, groupId: string, sessionDate: string, attended: number) => ({
        id: `${slotId}-${sessionDate}`,
        workspaceId: 'ws',
        groupId,
        slotId,
        gymId: 'gym',
        sessionDate: new Date(`${sessionDate}T00:00:00Z`),
        dayOfWeek: 1,
        startTime: '19:00',
        held: true,
        attended,
        roster: 10,
        capacity: null,
        booked: 0,
        missedBookings: 0,
    })

    it('names the slots, drops deleted groups and clamps the window', async () => {
        const prisma = makePrisma()
        prisma.analyticsSlotOccurrence.findMany.mockResolvedValue([
            occ('s1', 'g1', '2026-10-19', 10),
            occ('s1', 'g1', '2026-10-26', 9),
            occ('gone', 'deleted', '2026-10-26', 1),
        ])
        prisma.group.findMany.mockResolvedValue([
            { id: 'g1', name: 'Вечер', directionId: 'd', gymId: 'gym', gym: { name: 'Юпитер' } },
        ])
        const r = await loadOccupancyReport(prisma as never, {
            workspaceId: 'ws',
            scope: ONLY_G1,
            now: NOW,
            weeks: 99,
        })
        expect(r.weeks).toBe(26)
        expect(prisma.analyticsSlotOccurrence.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'ws',
            sessionDate: { gte: new Date('2026-05-04T00:00:00Z') },
            groupId: { in: ['g1'] },
        })
        expect(r.slots.map((s) => [s.slotId, s.groupName, s.gymName, s.fill])).toEqual([
            ['s1', 'Вечер', 'Юпитер', 0.95],
        ])
        expect(r.strongest.map((s) => s.slotId)).toEqual(['s1'])
        expect(r.suggestions[0]).toMatchObject({ kind: 'add_class', slotId: 's1' })
        expect(r.heatmap).toEqual([
            {
                gymId: 'gym',
                gymName: 'Юпитер',
                cells: [{ dayOfWeek: 1, hour: 19, slots: 1, avgAttendance: 9.5, capacity: 10, fill: 0.95 }],
            },
        ])
    })
})

describe('loadCoachReport', () => {
    it('groups GroupCoach rows per coach and sorts by active students', async () => {
        const prisma = makePrisma()
        prisma.groupCoach.findMany.mockResolvedValue([
            { groupId: 'g1', userId: 'c1', user: { firstname: 'Яна', lastname: null, email: null } },
            { groupId: 'g2', userId: 'c2', user: { firstname: 'Антон', lastname: null, email: null } },
            { groupId: 'g3', userId: 'c2', user: { firstname: 'Антон', lastname: null, email: null } },
        ])
        prisma.analyticsMemberGroupStat.findMany.mockResolvedValue([
            { userId: 'u1', groupId: 'g1', firstVisitAt: ago(200), lastVisitAt: ago(3), visits: 20 },
            { userId: 'u2', groupId: 'g3', firstVisitAt: ago(200), lastVisitAt: ago(100), visits: 5 },
        ])
        prisma.analyticsMemberSnapshot.findMany.mockResolvedValue([
            { userId: 'u1', renewalsDue: 2, renewalsDone: 2 },
        ])
        const r = await loadCoachReport(prisma as never, { workspaceId: 'ws', scope: WHOLE, now: NOW })
        expect(r.coaches.map((c) => [c.coachId, c.firstname, c.groupIds, c.activeStudents])).toEqual([
            ['c1', 'Яна', ['g1'], 1],
            ['c2', 'Антон', ['g2', 'g3'], 0],
        ])
        expect(r.coaches[0].renewals).toEqual({ due: 2, done: 2, rate: 1 })
        expect(r.coaches[1].retention).toEqual({ eligible: 1, retained: 0, rate: 0 })
        expect(r.weeks).toBe(12)
    })

    it('counts the renewals of students who have left in their coach’s groups', async () => {
        const prisma = makePrisma()
        prisma.groupCoach.findMany.mockResolvedValue([
            { groupId: 'g1', userId: 'c1', user: { firstname: 'Яна', lastname: null, email: null } },
        ])
        prisma.analyticsMemberGroupStat.findMany.mockResolvedValue([
            { userId: 'u1', groupId: 'g1', firstVisitAt: ago(200), lastVisitAt: ago(3), visits: 20 },
            { userId: 'gone', groupId: 'g1', firstVisitAt: ago(170), lastVisitAt: ago(60), visits: 9 },
        ])
        prisma.analyticsMemberSnapshot.findMany.mockResolvedValue([
            { userId: 'u1', renewalsDue: 2, renewalsDone: 2 },
        ])
        prisma.analyticsFormerMember.findMany.mockResolvedValue([
            { userId: 'gone', renewalsDue: 3, renewalsDone: 2 },
            // Left and came back: both rows add up.
            { userId: 'u1', renewalsDue: 1, renewalsDone: 0 },
        ])
        const r = await loadCoachReport(prisma as never, { workspaceId: 'ws', scope: WHOLE, now: NOW })
        expect(r.coaches[0].renewals).toEqual({ due: 6, done: 4, rate: 4 / 6 })
    })

    it('counts a class a substitute ran for the substitute, not the group coach', async () => {
        const prisma = makePrisma()
        prisma.groupCoach.findMany.mockResolvedValue([
            { groupId: 'g1', userId: 'c1', user: { firstname: 'Яна', lastname: null, email: null } },
        ])
        prisma.analyticsSlotOccurrence.findMany.mockResolvedValue([
            { slotId: 'sl1', groupId: 'g1', sessionDate: new Date('2026-10-20T00:00:00Z'), held: true, attended: 6 },
            { slotId: 'sl1', groupId: 'g1', sessionDate: new Date('2026-10-27T00:00:00Z'), held: true, attended: 4 },
        ])
        prisma.classSubstitution.findMany.mockResolvedValue([
            {
                slotId: 'sl1',
                sessionDate: new Date('2026-10-20T00:00:00Z'),
                substituteId: 'c3',
                substitute: { firstname: 'Олег', lastname: null, email: null },
            },
        ])
        const r = await loadCoachReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })
        expect(prisma.classSubstitution.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'ws',
            status: 'APPROVED',
            groupId: { in: ['g1'] },
        })
        const byId = new Map(r.coaches.map((c) => [c.coachId, c]))
        expect(byId.get('c1')).toMatchObject({ classes: 1, avgAttendance: 4 })
        expect(byId.get('c3')).toMatchObject({ firstname: 'Олег', groupIds: [], classes: 1, avgAttendance: 6 })
    })
})

describe('loadForecastReport', () => {
    // A 30-day paid abonement held now: 6 000 a month.
    const current = {
        amountPaid: 6000,
        refundedAmount: 0,
        currency: 'RUB',
        isPaid: true,
        startDate: ago(10),
        endDate: new Date(NOW.getTime() + 20 * DAY),
    }

    it('sums the scope’s snapshot rows; students and income are the live metrics of the scope', async () => {
        const prisma = makePrisma()
        prisma.analyticsMemberSnapshot.findMany.mockResolvedValue([
            snapshot('a'),
            snapshot('b', { score: 10, monthlySpend: 4000, currency: null, trialStartedAt: ago(30), trialConvertedAt: ago(28) }),
            snapshot('other', { groupIds: ['g2'] }),
        ])
        prisma.workspaceMember.count.mockResolvedValue(2)
        prisma.subscription.findMany.mockResolvedValue([current])
        const r = await loadForecastReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })
        expect(r).toEqual({
            computedAt: RUN.riskComputedAt,
            currency: 'RUB',
            students: 2,
            mrr: 6000,
            horizons: [
                { days: 30, potential: 10000, expected: 2000, atRisk: 8000 },
                { days: 90, potential: 30000, expected: 4000, atRisk: 26000 },
            ],
            renewal: { clubRate: 0.6, clubSample: 20, scopeRate: null, scopeSample: 8, usesDefault: false },
            highRiskMoney: 5000,
            trial: { trials: 1, converted: 1, rate: 1, medianDaysToPay: 2 },
        })
        // Both live figures narrow to the students of the scope's groups.
        const inGroups = { user: { groupMemberships: { some: { groupId: { in: ['g1'] } } } } }
        expect(prisma.workspaceMember.count.mock.calls[0][0].where.AND).toContainEqual(inGroups)
        expect(prisma.subscription.findMany.mock.calls[0][0].where.workspaceMember).toEqual(inGroups)
    })

    it('the whole club reads every student and every current abonement', async () => {
        const prisma = makePrisma()
        await loadForecastReport(prisma as never, { workspaceId: 'ws', scope: WHOLE, now: NOW })
        expect(prisma.workspaceMember.count.mock.calls[0][0].where).not.toHaveProperty('AND')
        expect(prisma.subscription.findMany.mock.calls[0][0].where).not.toHaveProperty('workspaceMember')
    })

    it('counts the scope’s former students in the renewal share and trials, not in money', async () => {
        const prisma = makePrisma()
        prisma.analyticsMemberSnapshot.findMany.mockResolvedValue([
            snapshot('a', { renewalsDue: 8, renewalsDone: 8 }),
        ])
        prisma.analyticsFormerMember.findMany.mockResolvedValue([
            {
                workspaceId: 'ws',
                userId: 'gone',
                groupIds: ['g1'],
                renewalsDue: 4,
                renewalsDone: 1,
                trialStartedAt: ago(40),
                trialConvertedAt: null,
                computedAt: NOW,
            },
            {
                workspaceId: 'ws',
                userId: 'elsewhere',
                groupIds: ['g2'],
                renewalsDue: 9,
                renewalsDone: 0,
                trialStartedAt: null,
                trialConvertedAt: null,
                computedAt: NOW,
            },
        ])
        const r = await loadForecastReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })
        expect(r.renewal).toMatchObject({ scopeRate: 9 / 12, scopeSample: 12 })
        expect(r.trial).toMatchObject({ trials: 1, converted: 0 })
        // Money and the horizons are about the ones still here.
        expect(r.horizons[0]).toMatchObject({ potential: 5000, expected: 1000 })
        expect(r.highRiskMoney).toBe(5000)
    })

    it('falls back to the default rate without a run', async () => {
        const prisma = makePrisma()
        prisma.analyticsRun.findUnique.mockResolvedValue(null)
        const r = await loadForecastReport(prisma as never, { workspaceId: 'ws', scope: WHOLE, now: NOW })
        expect(r.renewal).toEqual({
            clubRate: 0.7,
            clubSample: 0,
            scopeRate: null,
            scopeSample: 0,
            usesDefault: true,
        })
        expect(r.students).toBe(0)
    })
})
