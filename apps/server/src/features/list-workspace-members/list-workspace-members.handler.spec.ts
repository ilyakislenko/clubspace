import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
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

// The demo club: direction БЖЖ run by `bjj` (who coaches none of its groups);
// g-bjj-a led by coach-a with assistant `asst`, g-bjj-b led by coach-b, and a
// boxing group without a direction. The junction holds primary + assistants.
const GROUPS = [
    { id: 'g-bjj-a', coaches: ['coach-a', 'asst'], managers: ['bjj'], members: ['s1'] },
    { id: 'g-bjj-b', coaches: ['coach-b'], managers: ['bjj'], members: ['s2'] },
    { id: 'g-box', coaches: ['coach-c'], managers: [], members: ['s3'] },
]

type OwnGroupsClause =
    | { coaches: { some: { userId: string } } }
    | { direction: { managers: { some: { userId: string } } } }

// Evaluates the ownGroupsWhere shape the way the database would, so the
// tests check who ends up visible, not just the literal where.
const groupMemberFindMany = jest.fn(
    async (args: { where: { group: { OR: OwnGroupsClause[] } } }) => {
        const hit = GROUPS.filter((g) =>
            args.where.group.OR.some((c) =>
                'coaches' in c
                    ? g.coaches.includes(c.coaches.some.userId)
                    : g.managers.includes(c.direction.managers.some.userId),
            ),
        )
        return [...new Set(hit.flatMap((g) => g.members))].map((userId) => ({
            userId,
        }))
    },
)

const make = (members: unknown[], scope = 'admin') => {
    const prisma = {
        groupMember: { findMany: groupMemberFindMany },
        workspaceMember: { findMany: jest.fn().mockResolvedValue(members) },
        videoWatched: {
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
        },
        attendanceRecord: { groupBy: jest.fn().mockResolvedValue([]) },
        video: { count: jest.fn().mockResolvedValue(0) },
    }
    // The real scope rules over the Prisma double; only the role lookup is
    // stubbed.
    const rbac = new RbacService(prisma as never)
    jest.spyOn(rbac, 'resolveCoachScope').mockImplementation(async (p) => ({
        scope: scope as 'admin' | 'coach_read_all' | 'coach_own_only',
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: 'owner',
    }))
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
    beforeEach(() => groupMemberFindMany.mockClear())

    it('refuses a caller the coach scope rejects, before reading members', async () => {
        const { prisma, rbac, run } = make([])
        jest.spyOn(rbac, 'resolveCoachScope').mockRejectedValue(
            new ForbiddenError({ message: 'nope' }),
        )
        await expect(run('u1', 'user')).rejects.toThrow(ForbiddenError)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    const scopedIds = async (invoker: string) => {
        const { prisma, run } = make([], 'coach_own_only')
        const out = await run(invoker, 'coach')
        expect(out).toEqual({ data: [], total: 0, workspaceVideoTotal: 0 })
        // The one own-groups rule (ownGroupsWhere), limited to the club.
        expect(groupMemberFindMany).toHaveBeenCalledWith({
            where: { group: { workspaceId: 'w1', ...ownGroupsWhere(invoker) } },
            distinct: ['userId'],
            select: { userId: true },
        })
        const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
        return [...where.userId.in].sort()
    }

    it('narrows a plain coach to their own students, self and the owner', async () => {
        await expect(scopedIds('coach-b')).resolves.toEqual([
            'coach-b',
            'owner',
            's2',
        ])
    })

    it('shows a direction manager the students of every group of the direction', async () => {
        // s1 trains with coach-a: bjj leads no group, yet runs БЖЖ.
        await expect(scopedIds('bjj')).resolves.toEqual([
            'bjj',
            'owner',
            's1',
            's2',
        ])
    })

    it('shows an assistant coach the students of the group they assist', async () => {
        await expect(scopedIds('asst')).resolves.toEqual(['asst', 'owner', 's1'])
    })

    it('does not scope admin or coach_read_all', async () => {
        for (const scope of ['admin', 'coach_read_all']) {
            const { prisma, run } = make([], scope)
            await run()
            const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
            expect(where.userId).toBeUndefined()
        }
        expect(groupMemberFindMany).not.toHaveBeenCalled()
    })

    it('reads only current abonements, ending soonest first, with their scope', async () => {
        const { prisma, run } = make([])
        await run()
        const { include, where } =
            prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(where).toEqual({ workspaceId: 'w1', status: { not: 'INVITED' } })
        expect(include.subscriptions.where).toEqual({
            NOT: { workspaceMemberId: null },
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
