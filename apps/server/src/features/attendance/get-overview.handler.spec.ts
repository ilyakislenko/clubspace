import { GetAttendanceOverviewFeature } from './get-overview.feature'
import { GetAttendanceOverviewHandler } from './get-overview.handler'

const makePrisma = () => ({
    attendanceSession: { count: jest.fn().mockResolvedValue(7) },
    attendanceRecord: {
        count: jest.fn().mockResolvedValue(40),
        findMany: jest
            .fn()
            .mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]),
    },
})

const makeRbac = (scope = 'admin') => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope,
        userId: 'u1',
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    }),
    canSeeAllGroups: jest.fn().mockReturnValue(scope === 'admin'),
})

const run = (prisma: any, rbac: any, payload: any = {}) =>
    new GetAttendanceOverviewHandler(prisma, rbac).execute(
        new GetAttendanceOverviewFeature(payload, 'w1', 'u1', 'admin', false),
    )

describe('getAttendanceOverview', () => {
    it('returns counts (sessions, check-ins, distinct attendees)', async () => {
        const out = await run(makePrisma(), makeRbac(), { days: 14 })
        expect(out).toEqual({
            days: 14,
            sessionsHeld: 7,
            totalCheckIns: 40,
            distinctAttendees: 2,
        })
    })

    it('scopes a non-see-all coach to their own groups', async () => {
        const prisma = makePrisma()
        await run(prisma, makeRbac('coach_own_only'))
        const sessionWhere =
            prisma.attendanceSession.count.mock.calls[0][0].where
        expect(sessionWhere.group).toEqual({
            coaches: { some: { userId: 'u1' } },
        })
        const recordWhere = prisma.attendanceRecord.count.mock.calls[0][0].where
        expect(recordWhere.session).toEqual({
            group: { coaches: { some: { userId: 'u1' } } },
        })
    })
})
