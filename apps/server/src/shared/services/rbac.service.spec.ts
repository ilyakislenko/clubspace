import { WORKSPACE_ADMINS } from '../decorators/roles.decorator'
import { ForbiddenError, NotFoundError } from '../errors/shared.errors'
import { RbacService } from './rbac.service'

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

describe('RbacService.assertCanWriteGroup', () => {
    it('lets through admin scope without checking the junction', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(
                ctx({ scope: 'admin' }),
                'group-1',
            ),
        ).resolves.toBeUndefined()
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
        ).resolves.toBeUndefined()
    })

    it('allows an assistant coach', async () => {
        const prisma = buildPrisma({ role: 'assistant' }) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
        ).resolves.toBeUndefined()
    })

    it('forbids non-coaches in coach_own_only scope', async () => {
        const prisma = buildPrisma(null) as never
        const svc = new RbacService(prisma)
        await expect(
            svc.assertCanWriteGroup(ctx(), 'group-1'),
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
                coaches: { some: { userId: 'coach-1' } },
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
