import { WORKSPACE_ADMINS } from '../decorators/roles.decorator'
import { ForbiddenError, NotFoundError } from '../errors/shared.errors'
import { ownGroupsWhere, RbacService } from './rbac.service'

// Inline minimal Prisma double — only the methods rbac.service touches
// in the paths under test. Keeps the test deterministic without a real
// DB or PrismaClient instantiation.
type GroupCoachStub = {
    role: 'primary' | 'assistant'
} | null

const buildPrisma = (
    coachAssignment: GroupCoachStub,
    workspaceMember: { isOwner?: boolean; roleName?: string } | null = null,
    groupMembership: { groupId: string } | null = null,
    groupInWorkspace: { id: string } | null = { id: 'group-1' },
) => ({
    group: {
        findFirst: jest.fn().mockResolvedValue(groupInWorkspace),
    },
    groupMember: {
        findFirst: jest.fn().mockResolvedValue(groupMembership),
    },
    groupCoach: {
        findFirst: jest.fn().mockResolvedValue(coachAssignment),
    },
    workspaceMember: {
        findFirst: jest.fn().mockResolvedValue(
            workspaceMember
                ? {
                      isOwner: workspaceMember.isOwner ?? false,
                      role: { name: workspaceMember.roleName ?? 'coach' },
                  }
                : null,
        ),
    },
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'ws-1', ownerId: 'owner-1' }),
    },
})

const ctx = (overrides: Partial<{ scope: string; userId: string }> = {}) => ({
    scope: (overrides.scope as 'admin' | 'coach_read_all' | 'coach_own_only') ??
        'coach_own_only',
    userId: overrides.userId ?? 'coach-1',
    workspaceId: 'ws-1',
    workspaceOwnerId: 'owner-1',
})

// DirectionManager double: the caller manages `managed` in ws-1.
const withManaged = <T extends object>(prisma: T, managed: string[]) => ({
    ...prisma,
    directionManager: {
        count: jest.fn(
            async (args: { where: { directionId: { in: string[] } } }) =>
                args.where.directionId.in.filter((d) => managed.includes(d))
                    .length,
        ),
        findMany: jest
            .fn()
            .mockResolvedValue(managed.map((directionId) => ({ directionId }))),
    },
})

describe('RbacService.assertCanWriteGroup', () => {
    it('lets through admin scope without checking the junction', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(
                ctx({ scope: 'admin' }),
                'group-1',
            ),
        ).resolves.toBe('admin')
        expect(prisma.groupCoach.findFirst).not.toHaveBeenCalled()
        expect(prisma.group.findFirst).toHaveBeenCalledWith({
            where: { id: 'group-1', workspaceId: 'ws-1' },
            select: { id: true },
        })
    })

    it('refuses admin scope for a group of another workspace', async () => {
        const prisma = buildPrisma(null, null, null, null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(ctx({ scope: 'admin' }), 'group-of-b'),
        ).rejects.toThrow(NotFoundError)
    })

    it('allows the primary coach', async () => {
        const prisma = buildPrisma({ role: 'primary' }) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
        ).resolves.toBe('coach')
    })

    it('allows an assistant coach', async () => {
        const prisma = buildPrisma({ role: 'assistant' }) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
        ).resolves.toBe('coach')
    })

    it('forbids non-coaches in coach_own_only scope', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
        ).rejects.toThrow(ForbiddenError)
    })

    it('lets the manager of the group direction through', async () => {
        const prisma = withManaged(
            buildPrisma(null, null, null, { directionId: 'dir-bjj' } as never),
            ['dir-bjj'],
        )
        const svc = new RbacService(prisma as never)
        await expect(svc.assertCanWriteGroup(ctx(), 'group-1')).resolves.toBe(
            'direction',
        )
    })

    it('forbids the manager of another direction', async () => {
        const prisma = withManaged(
            buildPrisma(null, null, null, { directionId: 'dir-mma' } as never),
            ['dir-bjj'],
        )
        const svc = new RbacService(prisma as never)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
        ).rejects.toThrow(ForbiddenError)
    })

    it('forbids a manager on a club-wide group without querying assignments', async () => {
        const prisma = withManaged(
            buildPrisma(null, null, null, { directionId: null } as never),
            ['dir-bjj'],
        )
        const svc = new RbacService(prisma as never)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
        ).rejects.toThrow(ForbiddenError)
        expect(prisma.directionManager.count).not.toHaveBeenCalled()
    })
})

describe('RbacService.assertCanManageDirection', () => {
    const svcWith = (managed: string[]) => {
        const prisma = withManaged(buildPrisma(null), managed)
        return { prisma, svc: new RbacService(prisma as never) }
    }

    it('lets admin scope through without a query, club-wide included', async () => {
        const { prisma, svc } = svcWith([])
        await expect(
            svc.assertCanManageDirection(ctx({ scope: 'admin' }), null),
        ).resolves.toBeUndefined()
        expect(prisma.directionManager.count).not.toHaveBeenCalled()
    })

    it('allows a manager on their direction, scoped to the club and caller', async () => {
        const { prisma, svc } = svcWith(['dir-bjj'])
        await expect(
            svc.assertCanManageDirection(ctx(), 'dir-bjj', undefined),
        ).resolves.toBeUndefined()
        expect(prisma.directionManager.count).toHaveBeenCalledWith({
            where: {
                workspaceId: 'ws-1',
                userId: 'coach-1',
                directionId: { in: ['dir-bjj'] },
            },
        })
    })

    it('refuses another direction and a move to one', async () => {
        const { svc } = svcWith(['dir-bjj'])
        await expect(
            svc.assertCanManageDirection(ctx(), 'dir-mma'),
        ).rejects.toThrow(ForbiddenError)
        await expect(
            svc.assertCanManageDirection(ctx(), 'dir-bjj', 'dir-mma'),
        ).rejects.toThrow(ForbiddenError)
    })

    it('refuses club-wide rows and fails closed when nothing is named', async () => {
        const { svc } = svcWith(['dir-bjj'])
        await expect(
            svc.assertCanManageDirection(ctx(), 'dir-bjj', null),
        ).rejects.toThrow(ForbiddenError)
        await expect(
            svc.assertCanManageDirection(ctx(), undefined),
        ).rejects.toThrow(ForbiddenError)
    })
})

describe('RbacService.assertManagesDirections', () => {
    it('returns null for admin scope and the ids for a manager', async () => {
        const prisma = withManaged(buildPrisma(null), ['dir-bjj'])
        const svc = new RbacService(prisma as never)
        await expect(
            svc.assertManagesDirections(ctx({ scope: 'admin' })),
        ).resolves.toBeNull()
        await expect(svc.assertManagesDirections(ctx())).resolves.toEqual([
            'dir-bjj',
        ])
    })

    it('refuses a coach who manages nothing', async () => {
        const prisma = withManaged(buildPrisma(null), [])
        const svc = new RbacService(prisma as never)
        await expect(svc.assertManagesDirections(ctx())).rejects.toThrow(
            ForbiddenError,
        )
    })
})

describe('RbacService.assertCanCreateGroupAs', () => {
    it('lets a coach create their own group in any direction (unchanged)', async () => {
        const prisma = withManaged(buildPrisma(null), [])
        const svc = new RbacService(prisma as never)
        await expect(
            svc.assertCanCreateGroupAs(ctx(), 'coach-1', 'dir-mma'),
        ).resolves.toBeUndefined()
    })

    it('lets a manager pin another coach only in their direction', async () => {
        const prisma = withManaged(buildPrisma(null), ['dir-bjj'])
        const svc = new RbacService(prisma as never)
        await expect(
            svc.assertCanCreateGroupAs(ctx(), 'coach-2', 'dir-bjj'),
        ).resolves.toBeUndefined()
        await expect(
            svc.assertCanCreateGroupAs(ctx(), 'coach-2', 'dir-mma'),
        ).rejects.toThrow(ForbiddenError)
        await expect(
            svc.assertCanCreateGroupAs(ctx(), 'coach-2', null),
        ).rejects.toThrow(ForbiddenError)
    })
})

describe('RbacService.assertCanWriteMember', () => {
    it('lets through admin scope (owner, admin, head coach) without a query', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteMember(ctx({ scope: 'admin' }), 'student-1'),
        ).resolves.toBeUndefined()
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
    })

    it('allows a coach of one of the member groups via the GroupCoach join', async () => {
        const prisma = buildPrisma(null, null, { groupId: 'g1' }) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteMember(ctx(), 'student-1'),
        ).resolves.toBeUndefined()
        expect(prisma.groupMember.findFirst.mock.calls[0][0].where).toEqual({
            userId: 'student-1',
            group: {
                workspaceId: 'ws-1',
                OR: [
                    { coaches: { some: { userId: 'coach-1' } } },
                    { direction: { managers: { some: { userId: 'coach-1' } } } },
                ],
            },
        })
    })

    it('allows an assistant coach (the join covers primary and assistants)', async () => {
        const prisma = buildPrisma({ role: 'assistant' }, null, {
            groupId: 'g1',
        }) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteMember(ctx(), 'student-1'),
        ).resolves.toBeUndefined()
    })

    it('forbids a coach of another group', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteMember(ctx(), 'student-1'),
        ).rejects.toThrow(/не состоит в ваших группах/)
    })

    it('forbids a coach_read_all coach outside their groups (reads only widen)', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteMember(
                ctx({ scope: 'coach_read_all' }),
                'student-1',
            ),
        ).rejects.toThrow(ForbiddenError)
    })
})

describe('RbacService.canWriteMember', () => {
    it('is true for admin scope without a query', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.canWriteMember(ctx({ scope: 'admin' }), 'student-1'),
        ).resolves.toBe(true)
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
    })

    it('is true for a coach of one of the member groups', async () => {
        const svc = new RbacService(
            buildPrisma(null, null, { groupId: 'g1' }) as never,
        )
        await expect(svc.canWriteMember(ctx(), 'student-1')).resolves.toBe(true)
    })

    it('is false for a coach of another group, even with coach_read_all', async () => {
        const svc = new RbacService(buildPrisma(null) as never)
        await expect(svc.canWriteMember(ctx(), 'student-1')).resolves.toBe(false)
        await expect(
            svc.canWriteMember(ctx({ scope: 'coach_read_all' }), 'student-1'),
        ).resolves.toBe(false)
    })
})

describe('RbacService.assertCanReadMember', () => {
    it('lets through admin and coach_read_all without a query', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await svc.assertCanReadMember(ctx({ scope: 'admin' }), 'student-1')
        await svc.assertCanReadMember(
            ctx({ scope: 'coach_read_all' }),
            'student-1',
        )
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
    })

    it('limits coach_own_only to members of their groups', async () => {
        const ok = new RbacService(
            buildPrisma(null, null, { groupId: 'g1' }) as never,
        )
        await expect(
            ok.assertCanReadMember(ctx(), 'student-1'),
        ).resolves.toBeUndefined()
        const no = new RbacService(buildPrisma(null) as never)
        await expect(no.assertCanReadMember(ctx(), 'student-1')).rejects.toThrow(
            ForbiddenError,
        )
    })
})

describe('RbacService.ownGroupIds / ownGroupMemberIds', () => {
    // Coached (primary or assistant) groups plus every group of a managed
    // direction, limited to the club — the rule assertCanReadMember uses.
    const ownGroupsOfClub = {
        workspaceId: 'ws-1',
        ...ownGroupsWhere('coach-1'),
    }

    it('lists the club groups matching ownGroupsWhere', async () => {
        const findMany = jest.fn().mockResolvedValue([{ id: 'g1' }, { id: 'g2' }])
        const svc = new RbacService({ group: { findMany } } as never)
        await expect(svc.ownGroupIds(ctx())).resolves.toEqual(['g1', 'g2'])
        expect(findMany).toHaveBeenCalledWith({
            where: ownGroupsOfClub,
            select: { id: true },
        })
    })

    it('lists the distinct students of those groups', async () => {
        const findMany = jest
            .fn()
            .mockResolvedValue([{ userId: 's1' }, { userId: 's2' }])
        const svc = new RbacService({ groupMember: { findMany } } as never)
        await expect(svc.ownGroupMemberIds(ctx())).resolves.toEqual(['s1', 's2'])
        expect(findMany).toHaveBeenCalledWith({
            where: { group: ownGroupsOfClub },
            distinct: ['userId'],
            select: { userId: true },
        })
    })

    it('ownGroupsWhere covers the coaches junction and managed directions', () => {
        expect(ownGroupsWhere('u1')).toEqual({
            OR: [
                { coaches: { some: { userId: 'u1' } } },
                { direction: { managers: { some: { userId: 'u1' } } } },
            ],
        })
    })
})

describe('RbacService.resolveCoachScope', () => {
    const resolve = (roleName: string | null) =>
        new RbacService(buildPrisma(null) as never).resolveCoachScope({
            userId: 'u1',
            workspaceId: 'ws-1',
            roleName,
            isSuperAdmin: false,
        })

    it.each(WORKSPACE_ADMINS)('%s resolves to admin scope', async (role) => {
        await expect(resolve(role)).resolves.toMatchObject({ scope: 'admin' })
    })

    it('coach resolves to a coach scope, not admin', async () => {
        const out = await resolve('coach')
        expect(out.scope).toBe('coach_own_only')
    })

    it.each(['moderator', 'user', null])('%s is refused', async (role) => {
        await expect(resolve(role)).rejects.toThrow(ForbiddenError)
    })

    it('owner and superadmin resolve to admin regardless of role', async () => {
        const svc = new RbacService(buildPrisma(null) as never)
        await expect(
            svc.resolveCoachScope({
                userId: 'owner-1',
                workspaceId: 'ws-1',
                roleName: null,
                isSuperAdmin: false,
            }),
        ).resolves.toMatchObject({ scope: 'admin' })
        await expect(
            svc.resolveCoachScope({
                userId: 'x',
                workspaceId: 'ws-1',
                roleName: null,
                isSuperAdmin: true,
            }),
        ).resolves.toMatchObject({ scope: 'admin' })
    })
})

describe('RbacService.assertCanMarkClass', () => {
    const KEY = 'slot:slot-1:2026-11-05'
    // A coach who does not coach group-1; the club setting and the approved
    // substitution of KEY decide the rest.
    const markPrisma = (
        o: Partial<{
            coaches: boolean
            group: { coachesMarkAnyClass: boolean } | null
            substitution: { id: string } | null
        }> = {},
    ) => {
        const group =
            o.group === undefined
                ? { coachesMarkAnyClass: false }
                : o.group
        return {
            ...buildPrisma(o.coaches ? { role: 'primary' } : null),
            group: {
                findFirst: jest.fn().mockResolvedValue(
                    group
                        ? { id: 'group-1', directionId: null, workspace: group }
                        : null,
                ),
            },
            classSubstitution: {
                findFirst: jest.fn().mockResolvedValue(o.substitution ?? null),
            },
        }
    }

    it('passes whoever may write the group without further queries', async () => {
        const prisma = markPrisma({ coaches: true })
        const svc = new RbacService(prisma as never)
        await expect(svc.assertCanMarkClass(ctx(), 'group-1', KEY)).resolves.toBeUndefined()
        expect(prisma.classSubstitution.findFirst).not.toHaveBeenCalled()

        const admin = markPrisma()
        await expect(
            new RbacService(admin as never).assertCanMarkClass(ctx({ scope: 'admin' }), 'group-1', KEY),
        ).resolves.toBeUndefined()
        expect(admin.classSubstitution.findFirst).not.toHaveBeenCalled()
    })

    it('passes any coach when the club allows marking any class', async () => {
        const prisma = markPrisma({ group: { coachesMarkAnyClass: true } })
        const svc = new RbacService(prisma as never)
        await expect(svc.assertCanMarkClass(ctx(), 'group-1', null)).resolves.toBeUndefined()
        expect(prisma.classSubstitution.findFirst).not.toHaveBeenCalled()
    })

    it('passes the approved substitute of that very occurrence', async () => {
        const prisma = markPrisma({ substitution: { id: 'sub-1' } })
        const svc = new RbacService(prisma as never)
        await expect(svc.assertCanMarkClass(ctx(), 'group-1', KEY)).resolves.toBeUndefined()
        expect(prisma.classSubstitution.findFirst).toHaveBeenCalledWith({
            where: {
                workspaceId: 'ws-1',
                occurrenceKey: KEY,
                groupId: 'group-1',
                substituteId: 'coach-1',
                status: 'APPROVED',
            },
            select: { id: true },
        })
    })

    it('refuses another coach without a substitution (and an ad-hoc class has none)', async () => {
        const prisma = markPrisma()
        const svc = new RbacService(prisma as never)
        await expect(svc.assertCanMarkClass(ctx(), 'group-1', KEY)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        await expect(svc.assertCanMarkClass(ctx(), 'group-1', null)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.classSubstitution.findFirst).toHaveBeenCalledTimes(1)
    })

    it('404s a group of another club, even for admin scope', async () => {
        const prisma = markPrisma({ group: null, substitution: { id: 'sub-1' } })
        const svc = new RbacService(prisma as never)
        await expect(svc.assertCanMarkClass(ctx(), 'group-of-b', KEY)).rejects.toBeInstanceOf(
            NotFoundError,
        )
        await expect(
            svc.assertCanMarkClass(ctx({ scope: 'admin' }), 'group-of-b', KEY),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.classSubstitution.findFirst).not.toHaveBeenCalled()
    })
})
