jest.mock('../../domains/analytics/analytics-reports', () => ({
    loadCohortReport: jest.fn(),
    loadOccupancyReport: jest.fn(),
    loadCoachReport: jest.fn(),
    loadForecastReport: jest.fn(),
}))

import {
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

const OWNER = { roleName: 'admin', userId: 'owner' }
const ADMIN = { roleName: 'admin', userId: 'adm' }
const HEAD_COACH = { roleName: 'head_coach', userId: 'hc' }
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

// Club money: the forecast is for the owner and admins only.
describe('GetRevenueForecastHandler', () => {
    const run = (p: ReturnType<typeof setup>, who: Who, payload = {}) =>
        new GetRevenueForecastHandler(p.prisma as never, p.rbac).execute(
            new GetRevenueForecastFeature(payload, 'ws', who.userId, who.roleName, false),
        )

    it.each([
        ['a head coach', HEAD_COACH],
        ['a coach', COACH],
        ['a plain member', MEMBER],
    ])('refuses %s before reading anything', async (_, who) => {
        await expect(run(setup(), who)).rejects.toBeInstanceOf(ForbiddenError)
        expect(loadForecastReport).not.toHaveBeenCalled()
    })

    it.each([
        ['the owner', OWNER],
        ['an admin', ADMIN],
    ])('reads the whole club for %s', async (_, who) => {
        ;(loadForecastReport as jest.Mock).mockResolvedValue({ computedAt: AT, members: 3 })
        await expect(run(setup(), who)).resolves.toEqual({
            computedAt: AT.toISOString(),
            members: 3,
        })
        expect((loadForecastReport as jest.Mock).mock.calls[0][1]).toMatchObject({
            workspaceId: 'ws',
            scope: WHOLE,
        })
    })

    it('404s on a gym of another club', async () => {
        await expect(run(setup(), ADMIN, { gymId: 'foreign' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})

// Comparing coaches is for sport leads; a coach (a direction manager is one)
// does not rank colleagues.
describe('GetCoachAnalyticsHandler', () => {
    const run = (p: ReturnType<typeof setup>, who: Who) =>
        new GetCoachAnalyticsHandler(p.prisma as never, p.rbac).execute(
            new GetCoachAnalyticsFeature({}, 'ws', who.userId, who.roleName, false),
        )

    it.each([
        ['a coach', COACH],
        ['a plain member', MEMBER],
    ])('refuses %s before reading anything', async (_, who) => {
        await expect(run(setup(), who)).rejects.toBeInstanceOf(ForbiddenError)
        expect(loadCoachReport).not.toHaveBeenCalled()
    })

    it.each([
        ['the owner', OWNER],
        ['an admin', ADMIN],
        ['a head coach', HEAD_COACH],
    ])('reads the whole club for %s', async (_, who) => {
        ;(loadCoachReport as jest.Mock).mockResolvedValue({ computedAt: null, weeks: 12, coaches: [] })
        await expect(run(setup(), who)).resolves.toEqual({ computedAt: null, weeks: 12, coaches: [] })
        expect((loadCoachReport as jest.Mock).mock.calls[0][1].scope).toEqual(WHOLE)
    })
})
