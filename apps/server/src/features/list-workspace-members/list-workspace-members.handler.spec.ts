import { notAttendedWhere } from '../../domains/metrics/attendance'
import { memberRosterWhere } from '../../domains/metrics/students'
import { owesPaymentWhere } from '../../domains/subscriptions/renewal-rules'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersInput,
    ListWorkspaceMembersInputSchema,
} from './list-workspace-members.feature'
import {
    ListWorkspaceMembersHandler,
    memberAccessWhere,
    memberOrderBy,
    memberSearchWhere,
} from './list-workspace-members.handler'

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

type Where = { AND: Array<{ userId?: { in: string[] } }> }
// The coach scope's id list inside the AND (undefined = not scoped).
const scopeIdsOf = (where: Where) =>
    where.AND.find((c) => c.userId !== undefined)?.userId?.in

const make = (members: unknown[], scope = 'admin', total = members.length) => {
    const prisma = {
        groupMember: { findMany: groupMemberFindMany },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue(members),
            count: jest.fn().mockResolvedValue(total),
        },
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
    const run = (
        invoker = 'admin1',
        role = 'admin',
        payload: ListWorkspaceMembersInput = {},
    ) =>
        handler.execute(
            new ListWorkspaceMembersFeature(payload, 'w1', invoker, role, false),
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
        expect(out).toEqual({
            data: [],
            total: 0,
            curPage: 1,
            perPage: 50,
            workspaceVideoTotal: 0,
        })
        // The one own-groups rule (ownGroupsWhere), limited to the club.
        expect(groupMemberFindMany).toHaveBeenCalledWith({
            where: { group: { workspaceId: 'w1', ...ownGroupsWhere(invoker) } },
            distinct: ['userId'],
            select: { userId: true },
        })
        const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
        return [...scopeIdsOf(where)!].sort()
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
            expect(scopeIdsOf(where)).toBeUndefined()
        }
        expect(groupMemberFindMany).not.toHaveBeenCalled()
    })

    it('reads only current abonements, ending soonest first, with their scope', async () => {
        const { prisma, run } = make([])
        await run()
        const { include, where } =
            prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(where).toEqual({ AND: [memberRosterWhere('w1')] })
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

describe('ListWorkspaceMembersHandler pagination', () => {
    // 7 members already in the requested order; the double honours skip/take
    // the way the database does.
    const ROSTER = Array.from({ length: 7 }, (_, i) => memberRow(`u${i}`))
    const paged = () => {
        const made = make([], 'admin', ROSTER.length)
        made.prisma.workspaceMember.findMany.mockImplementation(
            async (args: { skip: number; take: number }) =>
                ROSTER.slice(args.skip, args.skip + args.take),
        )
        return made
    }

    it('returns 50 per page by default, from the first row', async () => {
        const { prisma, run } = make([], 'admin', 0)
        const out = await run()
        const args = prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(args).toMatchObject({ skip: 0, take: 50 })
        expect(out).toMatchObject({ curPage: 1, perPage: 50 })
    })

    it('walks every member exactly once across pages, with the filtered total', async () => {
        const { run } = paged()
        const pages = []
        for (const curPage of [1, 2, 3]) {
            pages.push(
                await run('admin1', 'admin', { curPage, perPage: 3 }),
            )
        }
        expect(pages.map((p) => p.data.map((m) => m.userId))).toEqual([
            ['u0', 'u1', 'u2'],
            ['u3', 'u4', 'u5'],
            ['u6'],
        ])
        expect(pages.map((p) => [p.total, p.curPage, p.perPage])).toEqual([
            [7, 1, 3],
            [7, 2, 3],
            [7, 3, 3],
        ])
    })

    it('counts and pages with the same where', async () => {
        const { prisma, run } = paged()
        await run('admin1', 'admin', { q: 'иван', access: 'unpaid' })
        const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(prisma.workspaceMember.count).toHaveBeenCalledWith({ where })
    })

    it('computes progress and check-ins for the returned page only', async () => {
        const { prisma, run } = paged()
        await run('admin1', 'admin', { curPage: 2, perPage: 3 })
        const page = ['u3', 'u4', 'u5']
        for (const call of [
            ...prisma.videoWatched.groupBy.mock.calls,
            ...prisma.videoWatched.findMany.mock.calls,
            ...prisma.attendanceRecord.groupBy.mock.calls,
        ]) {
            expect(call[0].where.userId).toEqual({ in: page })
        }
        expect(prisma.videoWatched.groupBy).toHaveBeenCalledTimes(2)
        expect(prisma.videoWatched.findMany).toHaveBeenCalledTimes(1)
        expect(prisma.attendanceRecord.groupBy).toHaveBeenCalledTimes(1)
    })

    it('skips the aggregates for an empty page', async () => {
        const { prisma, run } = make([], 'admin', 7)
        const out = await run('admin1', 'admin', { curPage: 9 })
        expect(out).toMatchObject({ data: [], total: 7, curPage: 9 })
        expect(prisma.videoWatched.groupBy).not.toHaveBeenCalled()
        expect(prisma.attendanceRecord.groupBy).not.toHaveBeenCalled()
    })

    it('ANDs the search into the coach scope instead of widening it', async () => {
        const { prisma, run } = make([], 'coach_own_only')
        await run('coach-b', 'coach', { q: 'петров' })
        const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(where.AND).toEqual([
            memberRosterWhere('w1'),
            { userId: { in: expect.arrayContaining(['coach-b', 'owner', 's2']) } },
            ...memberSearchWhere('петров'),
        ])
    })

    it('narrows to staff and the owner for the pickers', async () => {
        const { prisma, run } = make([])
        await run('admin1', 'admin', { staffOnly: true })
        const { where } = prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(where.AND).toEqual([
            memberRosterWhere('w1'),
            {
                OR: [
                    { role: { name: { in: ['admin', 'head_coach', 'coach'] } } },
                    { userId: 'owner' },
                ],
            },
        ])
    })
})

describe('memberSearchWhere', () => {
    it('needs every word somewhere in name, e-mail, phone or a guardian', () => {
        const terms = memberSearchWhere('  Иван   петров ')
        expect(terms).toHaveLength(2)
        const contains = { contains: 'Иван', mode: 'insensitive' }
        const person = [
            { firstname: contains },
            { lastname: contains },
            { email: contains },
            { phone: contains },
        ]
        expect(terms[0]).toEqual({
            user: {
                OR: [
                    ...person,
                    {
                        dependentOf: {
                            some: { guardian: { status: 'ACTIVE', OR: person } },
                        },
                    },
                ],
            },
        })
    })

    it('caps the number of words', () => {
        expect(memberSearchWhere('a b c d e f g')).toHaveLength(5)
    })
})

describe('memberAccessWhere', () => {
    const now = new Date('2026-11-08T12:00:00Z')
    const ctx = { workspaceId: 'w1', workspaceOwnerId: 'owner', now }
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner' }),
        },
        workspaceMember: {
            // One student out of classes, one with nothing to renew.
            findMany: jest.fn().mockResolvedValue([
                {
                    userId: 'due',
                    accessUntil: null,
                    user: { firstname: null, lastname: null, email: null, phone: null },
                    subscriptions: [
                        {
                            status: 'ACTIVE',
                            startDate: new Date('2026-10-01T00:00:00Z'),
                            endDate: null,
                            classesRemaining: 0,
                            classesTotal: 8,
                            plan: { id: 'p1', name: '8' },
                            directions: [],
                        },
                    ],
                },
                {
                    userId: 'fine',
                    accessUntil: null,
                    user: { firstname: null, lastname: null, email: null, phone: null },
                    subscriptions: [],
                },
            ]),
        },
    }
    const access = (a: Parameters<typeof memberAccessWhere>[1]) =>
        memberAccessWhere(prisma as never, a, ctx)

    it('adds nothing for everyone', async () => {
        expect(await access('all')).toBeNull()
    })

    it('«Кончается абонемент» lists exactly the renewal list’s members', async () => {
        expect(await access('renew')).toEqual({ userId: { in: ['due'] } })
    })

    it('«Должники» are members holding an unpaid abonement', async () => {
        expect(await access('unpaid')).toEqual(owesPaymentWhere)
    })

    it('«Не были 30 дней» is the shared attendance definition', async () => {
        expect(await access('inactive')).toEqual(
            notAttendedWhere('w1', 'owner', now),
        )
    })
})

describe('memberOrderBy', () => {
    it('ends every order on the row id, so pages never overlap', () => {
        for (const sort of ['name', 'expiry', 'newest', 'oldest', 'role'] as const) {
            expect(memberOrderBy(sort).at(-1)).toEqual({ id: 'asc' })
        }
    })
})

describe('ListWorkspaceMembersInputSchema', () => {
    it('caps the page size at 200 and parses query strings', () => {
        expect(
            ListWorkspaceMembersInputSchema.safeParse({ perPage: '201' }).success,
        ).toBe(false)
        expect(
            ListWorkspaceMembersInputSchema.parse({
                perPage: '200',
                curPage: '2',
                staffOnly: 'false',
                q: '  иван ',
            }),
        ).toEqual({ perPage: 200, curPage: 2, staffOnly: false, q: 'иван' })
    })
})
