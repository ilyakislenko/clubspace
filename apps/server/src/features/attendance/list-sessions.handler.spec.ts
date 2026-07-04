import { ListSessionsFeature } from './list-sessions.feature'
import { ListSessionsHandler } from './list-sessions.handler'

const dbSession = (over: Record<string, unknown> = {}) => ({
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'g1',
    slotId: 's1',
    workspaceEventId: null,
    sessionDate: new Date('2026-07-02T00:00:00Z'),
    title: 'Morning',
    startAt: new Date('2026-07-02T16:00:00Z'),
    timezone: 'Europe/Moscow',
    coachId: 'c1',
    notes: null,
    createdAt: new Date('2026-07-02T16:00:00Z'),
    updatedAt: new Date('2026-07-02T16:00:00Z'),
    _count: { records: 3 },
    ...over,
})

const makePrisma = () => ({
    attendanceSession: {
        findMany: jest.fn().mockResolvedValue([dbSession()]),
        count: jest.fn().mockResolvedValue(1),
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

const run = (prisma: any, rbac: any, payload: any) =>
    new ListSessionsHandler(prisma, rbac).execute(
        new ListSessionsFeature(payload, 'w1', 'u1', 'admin', false),
    )

describe('listSessions', () => {
    it('rejects a range wider than 90 days', async () => {
        await expect(
            run(makePrisma(), makeRbac(), {
                from: '2026-01-01',
                to: '2026-12-31',
            }),
        ).rejects.toThrow(/90 days/i)
    })

    it('rejects from after to', async () => {
        await expect(
            run(makePrisma(), makeRbac(), {
                from: '2026-07-10',
                to: '2026-07-01',
            }),
        ).rejects.toThrow(/before/i)
    })

    it('returns paginated serialized sessions with attendeeCount', async () => {
        const out = await run(makePrisma(), makeRbac(), {
            from: '2026-07-01',
            to: '2026-07-31',
        })
        expect(out.total).toBe(1)
        expect(out.curPage).toBe(1)
        expect(out.data[0]).toMatchObject({ id: 'sess1', attendeeCount: 3 })
    })

    it('restricts a non-see-all coach to their own groups', async () => {
        const prisma = makePrisma()
        await run(prisma, makeRbac('coach_own_only'), {
            from: '2026-07-01',
            to: '2026-07-31',
        })
        const where = prisma.attendanceSession.findMany.mock.calls[0][0].where
        expect(where.group).toEqual({
            coaches: { some: { userId: 'u1' } },
        })
    })
})
