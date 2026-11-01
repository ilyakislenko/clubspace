import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListWorkspaceMembersFeature } from './list-workspace-members.feature'
import { ListWorkspaceMembersHandler } from './list-workspace-members.handler'

const BJJ = { id: 'd-bjj', name: 'БЖЖ', color: '#f00', icon: null }

const memberRow = (userId: string, subscriptions: unknown[] = []) => ({
    id: `wm-${userId}`,
    status: 'ACTIVE',
    accessUntil: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    user: {
        id: userId,
        email: `${userId}@x`,
        firstname: 'F',
        lastname: 'L',
        dependentOf: [],
    },
    role: { name: 'user' },
    subscriptions,
})

const make = (members: unknown[], scope = 'admin') => {
    const prisma = {
        group: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ members: [{ userId: 'student' }] }]),
        },
        workspaceMember: { findMany: jest.fn().mockResolvedValue(members) },
        videoWatched: {
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        attendanceRecord: { groupBy: jest.fn().mockResolvedValue([]) },
        video: { count: jest.fn().mockResolvedValue(0) },
    }
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope, workspaceOwnerId: 'owner' }),
    }
    const handler = new ListWorkspaceMembersHandler(
        prisma as never,
        rbac as never,
    )
    const run = (invoker = 'admin1', role = 'admin') =>
        handler.execute(
            new ListWorkspaceMembersFeature('w1', invoker, role, false),
        )
    return { prisma, rbac, run }
}

describe('ListWorkspaceMembersHandler', () => {
    it('refuses a caller the coach scope rejects, before reading members', async () => {
        const { prisma, rbac, run } = make([])
        rbac.resolveCoachScope.mockRejectedValue(
            new ForbiddenError({ message: 'nope' }),
        )
        await expect(run('u1', 'user')).rejects.toThrow(ForbiddenError)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('narrows a coach to own groups, self and the owner', async () => {
        const { prisma, run } = make([], 'coach_own_only')
        const out = await run('coach1', 'coach')
        const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(where.userId.in.sort()).toEqual(['coach1', 'owner', 'student'])
        expect(out).toEqual({ data: [], total: 0, workspaceVideoTotal: 0 })
    })

    it('reads only current abonements, ending soonest first, with their scope', async () => {
        const { prisma, run } = make([])
        await run()
        const { include, where } =
            prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(where).toEqual({ workspaceId: 'w1', status: { not: 'INVITED' } })
        expect(include.subscriptions.where).toEqual({
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        })
        expect(include.subscriptions.orderBy).toEqual([
            { endDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
        ])
        expect(include.subscriptions.select.directions).toBeDefined()
    })

    it('shows every current abonement of a member, and none for a member without', async () => {
        const end = new Date('2026-12-01T00:00:00Z')
        const { run } = make([
            memberRow('two', [
                {
                    classesRemaining: 3,
                    classesTotal: 12,
                    endDate: end,
                    plan: { name: 'БЖЖ 12' },
                    directions: [{ direction: BJJ }],
                },
                {
                    classesRemaining: null,
                    classesTotal: null,
                    endDate: null,
                    plan: { name: 'Безлимит' },
                    directions: [],
                },
            ]),
            memberRow('none'),
        ])
        const out = await run()
        expect(out.data.map((m) => [m.userId, m.abonements])).toEqual([
            [
                'two',
                [
                    {
                        planName: 'БЖЖ 12',
                        classesRemaining: 3,
                        classesTotal: 12,
                        endDate: end.toISOString(),
                        directions: [BJJ],
                    },
                    {
                        planName: 'Безлимит',
                        classesRemaining: null,
                        classesTotal: null,
                        endDate: null,
                        directions: [],
                    },
                ],
            ],
            ['none', []],
        ])
        expect(out.total).toBe(2)
    })
})
