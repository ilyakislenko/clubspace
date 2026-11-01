jest.mock('../../domains/analytics/analytics-reports', () => ({
    loadChurnReport: jest.fn(),
    loadCohortReport: jest.fn(),
    loadOccupancyReport: jest.fn(),
    loadCoachReport: jest.fn(),
    loadForecastReport: jest.fn(),
}))

import {
    type ChurnEntry,
    loadChurnReport,
    loadCoachReport,
    loadCohortReport,
    loadForecastReport,
    loadOccupancyReport,
} from '../../domains/analytics/analytics-reports'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetCoachAnalyticsFeature } from './get-coach-analytics.feature'
import { GetCoachAnalyticsHandler } from './get-coach-analytics.handler'
import { GetCohortRetentionFeature } from './get-cohort-retention.feature'
import { GetCohortRetentionHandler } from './get-cohort-retention.handler'
import { GetRevenueForecastFeature } from './get-revenue-forecast.feature'
import { GetRevenueForecastHandler } from './get-revenue-forecast.handler'
import { GetScheduleOccupancyFeature } from './get-schedule-occupancy.feature'
import { GetScheduleOccupancyHandler } from './get-schedule-occupancy.handler'
import { ListChurnRiskFeature } from './list-churn-risk.feature'
import { ListChurnRiskHandler } from './list-churn-risk.handler'
import { RefreshAnalyticsFeature } from './refresh-analytics.feature'
import { RefreshAnalyticsHandler } from './refresh-analytics.handler'

const AT = new Date('2026-11-02T03:00:00.000Z')

const makePrisma = () => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: false }),
    },
    gym: { findFirst: jest.fn().mockResolvedValue(null) },
    direction: { findFirst: jest.fn().mockResolvedValue(null) },
    group: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'own' }]),
    },
    groupCoach: { findFirst: jest.fn().mockResolvedValue(null) },
    analyticsRun: {
        findUnique: jest.fn().mockResolvedValue({ historyComputedAt: AT, riskComputedAt: AT }),
    },
})

const ADMIN = { roleName: 'admin', userId: 'adm' }
const COACH = { roleName: 'coach', userId: 'coach' }
const MEMBER = { roleName: 'user', userId: 'm' }
type Who = { roleName: string | null; userId: string }

const WHOLE = { groupIds: null, includeGroupless: true }
const OWN = { groupIds: new Set(['own']), includeGroupless: false }

const setup = () => {
    const prisma = makePrisma()
    return { prisma, rbac: new RbacService(prisma as never) }
}

beforeEach(() => jest.clearAllMocks())

// The shared gate of every read: a member is refused, a foreign filter is a
// 404, admins read the whole club and a coach their own groups.
describe.each([
    {
        name: 'GetCohortRetentionHandler',
        loader: loadCohortReport as jest.Mock,
        report: { computedAt: AT, cohorts: [], average: [] },
        expected: { computedAt: AT.toISOString(), cohorts: [], average: [] },
        run: (p: ReturnType<typeof setup>, who: Who, payload = {}) =>
            new GetCohortRetentionHandler(p.prisma as never, p.rbac).execute(
                new GetCohortRetentionFeature(payload, 'ws', who.userId, who.roleName, false),
            ),
    },
    {
        name: 'GetCoachAnalyticsHandler',
        loader: loadCoachReport as jest.Mock,
        report: { computedAt: null, weeks: 12, coaches: [] },
        expected: { computedAt: null, weeks: 12, coaches: [] },
        run: (p: ReturnType<typeof setup>, who: Who, payload = {}) =>
            new GetCoachAnalyticsHandler(p.prisma as never, p.rbac).execute(
                new GetCoachAnalyticsFeature(payload, 'ws', who.userId, who.roleName, false),
            ),
    },
    {
        name: 'GetScheduleOccupancyHandler',
        loader: loadOccupancyReport as jest.Mock,
        report: {
            computedAt: AT,
            weeks: 8,
            slots: [],
            heatmap: [],
            weakest: [],
            strongest: [],
            suggestions: [],
        },
        expected: {
            computedAt: AT.toISOString(),
            weeks: 8,
            slots: [],
            heatmap: [],
            weakest: [],
            strongest: [],
            suggestions: [],
        },
        run: (p: ReturnType<typeof setup>, who: Who, payload = {}) =>
            new GetScheduleOccupancyHandler(p.prisma as never, p.rbac).execute(
                new GetScheduleOccupancyFeature(payload, 'ws', who.userId, who.roleName, false),
            ),
    },
    {
        name: 'GetRevenueForecastHandler',
        loader: loadForecastReport as jest.Mock,
        report: { computedAt: AT, members: 3 },
        expected: { computedAt: AT.toISOString(), members: 3 },
        run: (p: ReturnType<typeof setup>, who: Who, payload = {}) =>
            new GetRevenueForecastHandler(p.prisma as never, p.rbac).execute(
                new GetRevenueForecastFeature(payload, 'ws', who.userId, who.roleName, false),
            ),
    },
])('$name', ({ loader, report, expected, run }) => {
    it('refuses a plain member before reading anything', async () => {
        const p = setup()
        await expect(run(p, MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
        expect(loader).not.toHaveBeenCalled()
    })

    it('404s on a gym of another club', async () => {
        const p = setup()
        await expect(run(p, ADMIN, { gymId: 'foreign' })).rejects.toBeInstanceOf(NotFoundError)
        expect(loader).not.toHaveBeenCalled()
    })

    it('reads the whole club for an admin', async () => {
        const p = setup()
        loader.mockResolvedValue(report)
        await expect(run(p, ADMIN)).resolves.toEqual(expected)
        expect(loader.mock.calls[0][1]).toMatchObject({ workspaceId: 'ws', scope: WHOLE })
    })

    it('reads only the own groups of a coach', async () => {
        const p = setup()
        loader.mockResolvedValue(report)
        await run(p, COACH)
        expect(loader.mock.calls[0][1]).toMatchObject({ workspaceId: 'ws', scope: OWN })
    })
})

describe('GetScheduleOccupancyHandler weeks', () => {
    it('passes the requested window on', async () => {
        const p = setup()
        ;(loadOccupancyReport as jest.Mock).mockResolvedValue({
            computedAt: null,
            weeks: 4,
            slots: [],
            heatmap: [],
            weakest: [],
            strongest: [],
            suggestions: [],
        })
        await new GetScheduleOccupancyHandler(p.prisma as never, p.rbac).execute(
            new GetScheduleOccupancyFeature({ weeks: 4 }, 'ws', 'adm', 'admin', false),
        )
        expect((loadOccupancyReport as jest.Mock).mock.calls[0][1].weeks).toBe(4)
    })
})

describe('ListChurnRiskHandler', () => {
    const entry = (groups: ChurnEntry['groups']): ChurnEntry => ({
        userId: 'u1',
        firstname: 'Иван',
        lastname: null,
        email: null,
        phone: '+79000000000',
        guardians: [],
        groups,
        score: 72,
        level: 'high',
        reasons: [{ code: 'absent', points: 40, text: 'Не был на тренировке 50 дней' }],
        monthlySpend: 5000,
        currency: 'RUB',
        lastVisitAt: AT,
        lastContact: { id: 'c1', at: AT, byName: 'Тренер', note: null, reason: null, signals: [] },
        contactedRecently: true,
    })
    const report = (e: ChurnEntry) => ({
        computedAt: AT,
        entries: [e],
        summary: { total: 0, high: 0, medium: 0, moneyAtStake: 0, currency: null, contactedRecently: 1 },
    })
    const run = (p: ReturnType<typeof setup>, who: Who, payload = {}) =>
        new ListChurnRiskHandler(p.prisma as never, p.rbac).execute(
            new ListChurnRiskFeature(payload, 'ws', who.userId, who.roleName, false),
        )

    it('refuses a plain member', async () => {
        await expect(run(setup(), MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
        expect(loadChurnReport).not.toHaveBeenCalled()
    })

    it('404s on a group of another club', async () => {
        await expect(run(setup(), ADMIN, { groupId: 'foreign' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('serializes the list and lets an admin contact anyone', async () => {
        ;(loadChurnReport as jest.Mock).mockResolvedValue(report(entry([])))
        const res = await run(setup(), ADMIN, { minScore: 50 })
        expect((loadChurnReport as jest.Mock).mock.calls[0][1]).toMatchObject({
            scope: WHOLE,
            minScore: 50,
        })
        expect(res.computedAt).toBe(AT.toISOString())
        expect(res.data[0]).toMatchObject({
            userId: 'u1',
            score: 72,
            level: 'high',
            lastVisitAt: AT.toISOString(),
            lastContact: { id: 'c1', at: AT.toISOString(), byName: 'Тренер', note: null },
            contactedRecently: true,
            canContact: true,
        })
        expect(res.summary.contactedRecently).toBe(1)
    })

    it('lets a coach contact only members left in their groups', async () => {
        ;(loadChurnReport as jest.Mock).mockResolvedValue(
            report(entry([{ id: 'own', name: 'Вечер', gymId: null, gymName: null }])),
        )
        const own = await run(setup(), COACH)
        expect((loadChurnReport as jest.Mock).mock.calls[0][1].scope).toEqual(OWN)
        expect(own.data[0].canContact).toBe(true)
        ;(loadChurnReport as jest.Mock).mockResolvedValue(report(entry([])))
        expect((await run(setup(), COACH)).data[0].canContact).toBe(false)
    })
})

describe('RefreshAnalyticsHandler', () => {
    const run = (p: ReturnType<typeof setup>, who: Who, snapshots = { refresh: jest.fn() }) =>
        new RefreshAnalyticsHandler(p.prisma as never, p.rbac, snapshots as never).execute(
            new RefreshAnalyticsFeature('ws', who.userId, who.roleName, false),
        )

    it('refuses a coach', async () => {
        const snapshots = { refresh: jest.fn() }
        await expect(run(setup(), COACH, snapshots)).rejects.toBeInstanceOf(ForbiddenError)
        expect(snapshots.refresh).not.toHaveBeenCalled()
    })

    it('rebuilds the club snapshots for an admin and the owner', async () => {
        for (const who of [ADMIN, { roleName: null, userId: 'owner' }] as Who[]) {
            const snapshots = { refresh: jest.fn() }
            await expect(run(setup(), who, snapshots)).resolves.toEqual({
                historyComputedAt: AT.toISOString(),
                riskComputedAt: AT.toISOString(),
            })
            expect(snapshots.refresh).toHaveBeenCalledWith('ws')
        }
    })

    it('reports nothing computed when the run is missing', async () => {
        const p = setup()
        p.prisma.analyticsRun.findUnique.mockResolvedValue(null)
        await expect(run(p, ADMIN)).resolves.toEqual({ historyComputedAt: null, riskComputedAt: null })
    })
})
