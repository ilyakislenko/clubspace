import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveAnalyticsScope } from './analytics-scope'

const scopePrisma = (over: Record<string, unknown> = {}) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: true }),
    },
    gym: { findFirst: jest.fn().mockResolvedValue({ id: 'gym' }) },
    direction: { findFirst: jest.fn().mockResolvedValue({ id: 'dir' }) },
    group: {
        findFirst: jest.fn().mockResolvedValue({ id: 'g1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]),
    },
    groupCoach: { findFirst: jest.fn().mockResolvedValue({ userId: 'coach' }) },
    ...over,
})

type ScopePrisma = ReturnType<typeof scopePrisma>

const call = (prisma: ScopePrisma, roleName: string | null, filter = {}, userId = 'me') =>
    resolveAnalyticsScope(
        prisma as never,
        new RbacService(prisma as never),
        { workspaceId: 'ws', invokerUserId: userId, roleName, isSuperAdmin: false },
        filter,
    )

describe('resolveAnalyticsScope', () => {
    it('refuses a plain member', async () => {
        await expect(call(scopePrisma(), 'user')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('gives admins and the owner the whole club without a group query', async () => {
        for (const [role, user] of [['admin', 'me'], ['head_coach', 'me'], [null, 'owner']] as const) {
            const prisma = scopePrisma()
            const r = await call(prisma, role, {}, user)
            expect(r.isAdmin).toBe(true)
            expect(r.scope).toEqual({ groupIds: null, includeGroupless: true })
            expect(prisma.group.findMany).not.toHaveBeenCalled()
        }
    })

    it('narrows a coach to own groups even when coaches see all groups', async () => {
        const prisma = scopePrisma()
        const r = await call(prisma, 'coach')
        expect(r.isAdmin).toBe(false)
        expect(r.scope).toEqual({ groupIds: new Set(['g1', 'g2']), includeGroupless: false })
        expect(prisma.group.findMany).toHaveBeenCalledWith({
            where: {
                workspaceId: 'ws',
                OR: [
                    { coaches: { some: { userId: 'me' } } },
                    { direction: { managers: { some: { userId: 'me' } } } },
                ],
            },
            select: { id: true },
        })
    })

    it('applies every filter on top of the scope', async () => {
        const prisma = scopePrisma()
        await call(prisma, 'admin', { gymId: 'gym', directionId: 'dir', groupId: 'g1', coachId: 'coach' })
        expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'ws',
            gymId: 'gym',
            directionId: 'dir',
            id: 'g1',
            coaches: { some: { userId: 'coach' } },
        })
        expect(prisma.gym.findFirst).toHaveBeenCalledWith({
            where: { id: 'gym', workspaceId: 'ws' },
            select: { id: true },
        })
    })

    it.each([
        ['gymId', 'gym', 'Зал не найден'],
        ['directionId', 'direction', 'Направление не найдено'],
        ['groupId', 'group', 'Группа не найдена'],
        ['coachId', 'groupCoach', 'Тренер не найден'],
    ] as const)('404s on a %s from another club', async (key, model, message) => {
        const prisma = scopePrisma({
            [model]: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
        })
        await expect(call(prisma, 'admin', { [key]: 'foreign' })).rejects.toThrow(
            new NotFoundError({ message }),
        )
        expect(prisma.group.findMany).not.toHaveBeenCalled()
    })
})
