import {
    loadChurnReport,
    loadCoachReport,
    loadCohortReport,
    loadForecastReport,
    loadOccupancyReport,
} from './analytics-reports'

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
    analyticsMemberGroupStat: { findMany: jest.fn().mockResolvedValue([]) },
    analyticsSlotOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    group: { findMany: jest.fn().mockResolvedValue([]) },
    groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    classSubstitution: { findMany: jest.fn().mockResolvedValue([]) },
    memberRetentionContact: { findMany: jest.fn().mockResolvedValue([]) },
})

const person = (id: string, firstname: string) => ({
    id,
    firstname,
    lastname: null,
    email: null,
    phone: null,
    dependentOf: [],
})

describe('loadChurnReport', () => {
    it('lists the scope’s members, contacted ones last, with the money at stake', async () => {
        const prisma = makePrisma()
        prisma.analyticsMemberSnapshot.findMany.mockResolvedValue([
            snapshot('a', { score: 65 }),
            snapshot('b', { score: 90, groupIds: ['g1', 'g2'] }),
            snapshot('c', { score: 80 }),
            snapshot('other', { groupIds: ['g2'] }),
        ])
        prisma.user.findMany.mockResolvedValue([person('a', 'Анна'), person('b', 'Борис'), person('c', 'Вера')])
        prisma.group.findMany.mockResolvedValue([
            { id: 'g1', name: 'Вечер', gymId: 'gym', gym: { name: 'Юпитер' } },
            { id: 'g2', name: 'Утро', gymId: null, gym: null },
        ])
        prisma.memberRetentionContact.findMany.mockResolvedValue([
            {
                id: 'c1',
                userId: 'c',
                createdAt: ago(3),
                note: 'позвонили',
                reason: 'absent',
                signals: ['absent'],
                contactedBy: { firstname: 'Ольга', lastname: null, email: null },
            },
            {
                id: 'c2',
                userId: 'a',
                createdAt: ago(20),
                note: null,
                reason: null,
                signals: [],
                contactedBy: { firstname: null, lastname: null, email: 'x@y.z' },
            },
        ])

        const r = await loadChurnReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })

        expect(prisma.analyticsMemberSnapshot.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws', score: { gte: 35 } },
        })
        expect(r.entries.map((e) => [e.userId, e.contactedRecently])).toEqual([
            ['b', false],
            ['a', false],
            ['c', true],
        ])
        // Groups outside the scope are not shown.
        expect(r.entries[0].groups).toEqual([{ id: 'g1', name: 'Вечер', gymId: 'gym', gymName: 'Юпитер' }])
        expect(r.entries[0].reasons).toEqual([{ code: 'absent', points: 40, text: 'Не был 50 дней' }])
        expect(r.entries[1].lastContact).toMatchObject({ byName: 'x@y.z' })
        expect(r.summary).toEqual({
            total: 2,
            high: 2,
            medium: 0,
            moneyAtStake: 10000,
            currency: 'RUB',
            contactedRecently: 1,
        })
        expect(r.computedAt).toBe(RUN.riskComputedAt)
    })

    it('is empty before the first snapshot', async () => {
        const prisma = makePrisma()
        prisma.analyticsRun.findUnique.mockResolvedValue(null)
        const r = await loadChurnReport(prisma as never, { workspaceId: 'ws', scope: WHOLE, now: NOW, minScore: 0 })
        expect(r.computedAt).toBeNull()
        expect(r.entries).toEqual([])
        expect(prisma.analyticsMemberSnapshot.findMany.mock.calls[0][0].where.score).toEqual({ gte: 1 })
    })
})

describe('loadCohortReport', () => {
    it('merges the visits of the scope’s groups into cohorts', async () => {
        const prisma = makePrisma()
        prisma.analyticsMemberGroupStat.findMany.mockResolvedValue([
            { userId: 'a', groupId: 'g1', firstVisitAt: ago(100), lastVisitAt: ago(5), visits: 9 },
            { userId: 'a', groupId: null, firstVisitAt: ago(300), lastVisitAt: ago(299), visits: 1 },
            { userId: 'b', groupId: 'g2', firstVisitAt: ago(100), lastVisitAt: ago(90), visits: 2 },
        ])
        const r = await loadCohortReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })
        expect(r.cohorts).toHaveLength(1)
        expect(r.cohorts[0]).toMatchObject({ size: 1 })
        expect(r.average[0]).toEqual({ offset: 1, rate: 1, eligible: 1 })
        expect(r.computedAt).toBe(RUN.historyComputedAt)
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
    it('sums the scope’s members', async () => {
        const prisma = makePrisma()
        prisma.analyticsMemberSnapshot.findMany.mockResolvedValue([
            snapshot('a'),
            snapshot('b', { score: 10, monthlySpend: 4000, currency: null, trialStartedAt: ago(30), trialConvertedAt: ago(28) }),
            snapshot('other', { groupIds: ['g2'] }),
        ])
        const r = await loadForecastReport(prisma as never, { workspaceId: 'ws', scope: ONLY_G1, now: NOW })
        expect(r).toEqual({
            computedAt: RUN.riskComputedAt,
            currency: 'RUB',
            members: 2,
            monthlyRecurring: 9000,
            horizons: [
                { days: 30, potential: 10000, expected: 2000, atRisk: 8000 },
                { days: 90, potential: 30000, expected: 4000, atRisk: 26000 },
            ],
            renewal: { clubRate: 0.6, clubSample: 20, scopeRate: null, scopeSample: 8, usesDefault: false },
            highRiskMoney: 5000,
            trial: { trials: 1, converted: 1, rate: 1, medianDaysToPay: 2 },
        })
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
        expect(r.members).toBe(0)
    })
})
