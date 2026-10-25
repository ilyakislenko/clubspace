import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ListAtRiskMembersFeature } from './list-at-risk-members.feature'
import { ListAtRiskMembersHandler } from './list-at-risk-members.handler'

jest.mock('../../domains/retention/load-workspace-risk')
import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'

const OWNER = 'owner1'

const entry = (
    userId: string,
    groups: { id: string; gymId?: string | null }[],
    over: Record<string, unknown> = {},
) => ({
    userId,
    firstname: userId,
    lastname: null,
    email: `${userId}@x.io`,
    phone: null,
    groups: groups.map((g) => ({
        id: g.id,
        name: `name-${g.id}`,
        gymId: g.gymId ?? null,
        gymName: null,
    })),
    risk: {
        reason: 'absent',
        signals: ['absent'],
        facts: {
            lastVisitAt: new Date('2026-09-01T00:00:00Z'),
            daysSinceLastVisit: 30,
            firstVisitAt: new Date('2026-01-01T00:00:00Z'),
            daysSinceFirstVisit: 300,
            visitsLast14d: 0,
            recentPerWeek: 0,
            baselinePerWeek: 0,
            absentSinceFreeze: false,
            lapseKind: null,
            lapsedAt: null,
            planName: null,
        },
    },
    factsText: 'Последний визит 4 недели назад',
    lastContact: null,
    snoozed: false,
    ...over,
})

const ENTRIES = [
    entry('a', [{ id: 'g1', gymId: 'gym1' }, { id: 'g9' }]),
    entry('b', [{ id: 'g2', gymId: 'gym2' }]),
    entry('c', [], { snoozed: true }),
]

const make = (scope: string, coachGroupIds: string[] = ['g1']) => {
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope, userId: 'me', workspaceId: 'w1', workspaceOwnerId: OWNER }),
        canSeeAllGroups: jest.fn().mockReturnValue(scope !== 'coach_own_only'),
    }
    const prisma = {
        gym: { findFirst: jest.fn().mockResolvedValue({ id: 'gym1' }) },
        group: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
        groupCoach: {
            findMany: jest
                .fn()
                .mockResolvedValue(coachGroupIds.map((groupId) => ({ groupId }))),
        },
    }
    const handler = new ListAtRiskMembersHandler(prisma as never, rbac as never)
    return { handler, prisma, rbac }
}

const run = (
    handler: ListAtRiskMembersHandler,
    payload: Record<string, unknown> = {},
    invoker = 'me',
    role = 'coach',
) =>
    handler.execute(new ListAtRiskMembersFeature(payload, 'w1', invoker, role, false))

beforeEach(() => {
    ;(loadWorkspaceRisk as jest.Mock).mockReset().mockResolvedValue(ENTRIES)
})

describe('ListAtRiskMembersHandler', () => {
    it('propagates a refusal from resolveCoachScope', async () => {
        const { handler, rbac } = make('admin')
        rbac.resolveCoachScope.mockRejectedValueOnce(new ForbiddenError({ message: 'no' }))
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(loadWorkspaceRisk).not.toHaveBeenCalled()
    })

    it('lets an admin see everyone, with snoozed kept out of the totals', async () => {
        const { handler, prisma } = make('admin')
        const res = await run(handler, {}, 'admin1', 'admin')
        expect(res.data.map((m) => m.userId)).toEqual(['a', 'b', 'c'])
        expect(res.summary).toEqual({
            total: 2,
            lapsed: 0,
            newcomer: 0,
            absent: 2,
            declining: 0,
            snoozed: 1,
        })
        expect(prisma.groupCoach.findMany).not.toHaveBeenCalled()
    })

    it('shows a coach_own_only only their groups and narrows the group list', async () => {
        const { handler } = make('coach_own_only')
        const res = await run(handler)
        expect(res.data.map((m) => m.userId)).toEqual(['a'])
        expect(res.data[0].groups.map((g) => g.id)).toEqual(['g1'])
    })

    it('reads assistant-coach groups from the junction table', async () => {
        const { handler, prisma } = make('coach_own_only')
        await run(handler)
        expect(prisma.groupCoach.findMany.mock.calls[0][0].where).toEqual({
            userId: 'me',
            group: { workspaceId: 'w1' },
        })
    })

    it('lets coach_read_all see everyone, and scope=mine narrows it', async () => {
        const { handler } = make('coach_read_all', ['g2'])
        expect((await run(handler)).data.map((m) => m.userId)).toEqual(['a', 'b', 'c'])
        expect((await run(handler, { scope: 'mine' })).data.map((m) => m.userId)).toEqual([
            'b',
        ])
    })

    it('narrows an owner without a member row to their coached groups on scope=mine', async () => {
        const { handler, prisma } = make('admin', ['g2'])
        const res = await run(handler, { scope: 'mine' }, OWNER, 'admin')
        expect(res.data.map((m) => m.userId)).toEqual(['b'])
        expect(prisma.groupCoach.findMany.mock.calls[0][0].where.userId).toBe('me')
    })

    it('filters by gym and by group', async () => {
        const { handler } = make('admin')
        expect(
            (await run(handler, { gymId: 'gym2' })).data.map((m) => m.userId),
        ).toEqual(['b'])
        expect((await run(handler, { groupId: 'g9' })).data.map((m) => m.userId)).toEqual(['a'])
    })

    it('404s on an unknown gym or group', async () => {
        const { handler, prisma } = make('admin')
        prisma.gym.findFirst.mockResolvedValueOnce(null)
        await expect(run(handler, { gymId: 'x' })).rejects.toBeInstanceOf(NotFoundError)
        prisma.group.findFirst.mockResolvedValueOnce(null)
        await expect(run(handler, { groupId: 'x' })).rejects.toBeInstanceOf(NotFoundError)
        expect(loadWorkspaceRisk).not.toHaveBeenCalled()
    })

    it('serializes dates to ISO strings and flattens the reason', async () => {
        const { handler } = make('admin')
        const [first] = (await run(handler)).data
        expect(first.reason).toBe('absent')
        expect(first.facts.lastVisitAt).toBe('2026-09-01T00:00:00.000Z')
        expect(first.facts.lapsedAt).toBeNull()
    })
})
