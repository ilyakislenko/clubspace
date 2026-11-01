import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { AI_ACCESS_MESSAGE, resolveAiAccess } from './ai-access'

const NOW = new Date('2026-11-01T10:00:00Z')

const setup = (p: {
    member?: { status: string; accessUntil?: Date | null; role: string } | null
    managed?: string[]
}) => {
    const workspace = {
        name: 'ACADEMY',
        timezone: 'Europe/Moscow',
        ownerId: 'owner',
        coachSeesAllGroups: true,
    }
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue(workspace) },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(
                p.member
                    ? {
                          status: p.member.status,
                          accessUntil: p.member.accessUntil ?? null,
                          role: { name: p.member.role },
                      }
                    : null,
            ),
        },
        directionManager: {
            findMany: jest
                .fn()
                .mockResolvedValue((p.managed ?? []).map((directionId) => ({ directionId }))),
        },
    }
    const rbac = new RbacService(prisma as never)
    return {
        resolve: (userId: string) =>
            resolveAiAccess(prisma as never, rbac, { workspaceId: 'w1', userId, now: NOW }),
    }
}

describe('resolveAiAccess', () => {
    it('gives the owner the whole club, even without a member row', async () => {
        const access = await setup({ member: null }).resolve('owner')
        expect(access).toMatchObject({ isOwner: true, directionIds: null, roleName: null, timezone: 'Europe/Moscow' })
    })

    it.each(['admin', 'head_coach'])('gives %s the whole club', async (role) => {
        const access = await setup({ member: { status: 'ACTIVE', role } }).resolve('u1')
        expect(access).toMatchObject({ isOwner: false, directionIds: null, roleName: role })
    })

    it('narrows a direction manager to the directions they run', async () => {
        const access = await setup({
            member: { status: 'ACTIVE', role: 'coach' },
            managed: ['bjj'],
        }).resolve('u1')
        expect(access.directionIds).toEqual(['bjj'])
    })

    it.each([
        ['a plain coach', { status: 'ACTIVE', role: 'coach' }],
        ['a student', { status: 'ACTIVE', role: 'user' }],
        ['a blocked admin', { status: 'BLOCKED', role: 'admin' }],
        ['an admin whose access lapsed', { status: 'ACTIVE', role: 'admin', accessUntil: new Date('2026-10-01') }],
        ['a stranger', null],
    ])('refuses %s', async (_label, member) => {
        const promise = setup({ member }).resolve('u1')
        await expect(promise).rejects.toBeInstanceOf(ForbiddenError)
        await expect(setup({ member }).resolve('u1')).rejects.toThrow(AI_ACCESS_MESSAGE)
    })
})
