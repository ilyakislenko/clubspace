import { loadCohortReport } from '../analytics/analytics-reports'
import { countActiveStudentsMany } from '../metrics/active-students'
import { countStudentsAttended } from '../metrics/attendance'
import { loadCurrentSales, loadRefunds, loadSales } from '../metrics/revenue'
import { countNewStudents, countStudents } from '../metrics/students'
import { loadOrgClubMetrics, type OrgClubMetrics, summarizeOrgMetrics } from './club-metrics'

// The org reads a club only through the glossary functions the club's own
// screens use; they are mocked here so the spec pins *which* function feeds
// each figure, with which scope, and that money needs the club's opt-in.
jest.mock('../metrics/students', () => ({
    countStudents: jest.fn(),
    countNewStudents: jest.fn(),
}))
jest.mock('../metrics/attendance', () => ({ countStudentsAttended: jest.fn() }))
jest.mock('../metrics/active-students', () => ({ countActiveStudentsMany: jest.fn() }))
jest.mock('../analytics/analytics-reports', () => ({ loadCohortReport: jest.fn() }))
jest.mock('../metrics/revenue', () => ({
    ...jest.requireActual('../metrics/revenue'),
    loadCurrentSales: jest.fn(),
    loadSales: jest.fn(),
    loadRefunds: jest.fn(),
}))

const NOW = new Date('2026-11-26T12:00:00Z')
const DAY = 24 * 3600 * 1000

const link = (id: string, share: { mrr?: boolean; revenue?: boolean } = {}) => ({
    workspaceId: id,
    shareMrr: share.mrr ?? false,
    shareRevenue30d: share.revenue ?? false,
    workspace: { id, ownerId: `owner-${id}` },
})

const cohortWith = (eligible: number, retained: number) => ({
    computedAt: null,
    cohorts: [
        {
            month: '2026-06',
            size: eligible,
            cells: [{ offset: 3, eligible, retained, rate: retained / eligible, partial: false }],
        },
    ],
    average: [],
})

const setup = (links: ReturnType<typeof link>[]) => {
    const prisma = { organizationClub: { findMany: jest.fn().mockResolvedValue(links) } }
    ;(countActiveStudentsMany as jest.Mock).mockResolvedValue(
        new Map(links.map((l, i) => [l.workspaceId, 10 + i])),
    )
    ;(countStudents as jest.Mock).mockImplementation(async (_p, s) => (s.workspaceId === 'a' ? 40 : 25))
    ;(countStudentsAttended as jest.Mock).mockResolvedValue(20)
    ;(countNewStudents as jest.Mock).mockResolvedValue(3)
    ;(loadCohortReport as jest.Mock).mockImplementation(async (_p, q) =>
        q.workspaceId === 'a' ? cohortWith(10, 6) : cohortWith(30, 15),
    )
    ;(loadCurrentSales as jest.Mock).mockResolvedValue([
        {
            amountPaid: 6000,
            refundedAmount: 0,
            currency: 'RUB',
            isPaid: true,
            startDate: new Date(NOW.getTime() - 10 * DAY),
            endDate: new Date(NOW.getTime() + 20 * DAY),
        },
    ])
    ;(loadSales as jest.Mock).mockResolvedValue([
        { amountPaid: 6000, currency: 'RUB', paidAt: new Date(NOW.getTime() - DAY), createdAt: NOW, planId: 'p', planName: 'P' },
    ])
    ;(loadRefunds as jest.Mock).mockResolvedValue([])
    return prisma
}

describe('loadOrgClubMetrics', () => {
    beforeEach(() => jest.clearAllMocks())

    it('reads ACTIVE links only and returns nothing without one', async () => {
        const prisma = setup([])
        await expect(loadOrgClubMetrics(prisma as never, 'org', NOW)).resolves.toEqual([])
        expect(prisma.organizationClub.findMany.mock.calls[0][0].where).toEqual({
            organizationId: 'org',
            status: 'ACTIVE',
        })
        expect(countActiveStudentsMany).not.toHaveBeenCalled()
    })

    it('feeds every figure from the glossary function with the club scope', async () => {
        const prisma = setup([link('a')])
        const [row] = await loadOrgClubMetrics(prisma as never, 'org', NOW)
        const scope = { workspaceId: 'a', ownerId: 'owner-a' }
        const since30 = new Date(NOW.getTime() - 30 * DAY)
        expect(countStudents).toHaveBeenCalledWith(prisma, scope)
        expect(countStudentsAttended).toHaveBeenCalledWith(prisma, scope, since30)
        expect(countNewStudents).toHaveBeenCalledWith(prisma, scope, since30)
        expect(countActiveStudentsMany).toHaveBeenCalledWith(prisma, [{ id: 'a', ownerId: 'owner-a' }], NOW)
        expect(loadCohortReport).toHaveBeenCalledWith(prisma, {
            workspaceId: 'a',
            scope: { groupIds: null, includeGroupless: true },
            now: NOW,
        })
        expect(row).toEqual({
            workspaceId: 'a',
            students: 40,
            activeStudents: 10,
            attended30d: 20,
            new30d: 3,
            newcomerRetention3m: { rate: 0.6, eligible: 10 },
            mrr: null,
            revenue30d: null,
        })
    })

    it('loads no money at all for a club that shares none', async () => {
        const prisma = setup([link('a')])
        await loadOrgClubMetrics(prisma as never, 'org', NOW)
        expect(loadCurrentSales).not.toHaveBeenCalled()
        expect(loadSales).not.toHaveBeenCalled()
        expect(loadRefunds).not.toHaveBeenCalled()
    })

    it('shows each money figure only where the club opted into it', async () => {
        const prisma = setup([link('a', { mrr: true }), link('b', { revenue: true })])
        const [a, b] = await loadOrgClubMetrics(prisma as never, 'org', NOW)
        expect(a.mrr).toEqual({ amount: 6000, currency: 'RUB' })
        expect(a.revenue30d).toBeNull()
        expect(b.mrr).toBeNull()
        expect(b.revenue30d).toEqual({ amount: 6000, currency: 'RUB' })
    })
})

const row = (over: Partial<OrgClubMetrics>): OrgClubMetrics => ({
    workspaceId: 'x',
    students: 0,
    activeStudents: 0,
    attended30d: 0,
    new30d: 0,
    newcomerRetention3m: { rate: null, eligible: 0 },
    mrr: null,
    revenue30d: null,
    ...over,
})

describe('summarizeOrgMetrics', () => {
    it('sums counts and weights retention by eligible newcomers', () => {
        const t = summarizeOrgMetrics([
            row({ students: 40, activeStudents: 30, attended30d: 25, new30d: 3, newcomerRetention3m: { rate: 0.6, eligible: 10 } }),
            row({ students: 25, activeStudents: 20, attended30d: 15, new30d: 2, newcomerRetention3m: { rate: 0.5, eligible: 30 } }),
            row({ students: 5, newcomerRetention3m: { rate: null, eligible: 0 } }),
        ])
        expect(t).toMatchObject({ activeClubs: 3, students: 70, activeStudents: 50, attended30d: 40, new30d: 5 })
        // (6 + 15) / 40, not the plain mean of 0.6 and 0.5.
        expect(t.newcomerRetention3m).toEqual({ rate: 21 / 40, eligible: 40 })
    })

    it('money totals cover only the opted-in clubs («по N из M»)', () => {
        const t = summarizeOrgMetrics([
            row({ mrr: { amount: 100_000, currency: 'RUB' } }),
            row({}),
            row({ mrr: { amount: 50_000, currency: 'RUB' }, revenue30d: { amount: 70_000, currency: 'RUB' } }),
        ])
        expect(t.mrr).toEqual({ amount: 150_000, currency: 'RUB', clubs: 2 })
        expect(t.revenue30d).toEqual({ amount: 70_000, currency: 'RUB', clubs: 1 })
    })

    it('no sharing club → no money total; mixed currencies are not added up', () => {
        expect(summarizeOrgMetrics([row({})]).mrr).toBeNull()
        const t = summarizeOrgMetrics([
            row({ mrr: { amount: 1, currency: 'RUB' } }),
            row({ mrr: { amount: 2, currency: 'RUB' } }),
            row({ mrr: { amount: 5, currency: 'KZT' } }),
        ])
        expect(t.mrr).toEqual({ amount: 3, currency: 'RUB', clubs: 2 })
    })

    it('an empty org has zero counts and no retention', () => {
        expect(summarizeOrgMetrics([])).toEqual({
            activeClubs: 0,
            students: 0,
            activeStudents: 0,
            attended30d: 0,
            new30d: 0,
            newcomerRetention3m: { rate: null, eligible: 0 },
            mrr: null,
            revenue30d: null,
        })
    })
})
