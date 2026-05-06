import { ForbiddenError } from '../errors/shared.errors'
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
) => ({
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
