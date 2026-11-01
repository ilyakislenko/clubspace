import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    AssignDirectionManagerFeature,
    ListDirectionManagersFeature,
    RemoveDirectionManagerFeature,
} from './direction-managers.feature'
import {
    AssignDirectionManagerHandler,
    ListDirectionManagersHandler,
    RemoveDirectionManagerHandler,
} from './direction-managers.handler'

const CREATED = new Date('2026-11-01T10:00:00.000Z')
const managerRow = (directionId = 'dir-bjj', userId = 'coach-1') => ({
    id: 'dm-1',
    workspaceId: 'w1',
    directionId,
    userId,
    createdAt: CREATED,
    user: { email: 'c@club.ru', firstname: 'Иван', lastname: 'Петров' },
})

const rbac = (admin = true) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: admin ? 'admin' : 'coach_own_only',
        userId: 'admin-1',
        workspaceId: 'w1',
        workspaceOwnerId: 'owner-1',
    }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const build = (o: {
    admin?: boolean
    direction?: { id: string; name: string } | null
    memberRole?: string | null
    createError?: unknown
} = {}) => {
    const prisma = {
        direction: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    o.direction === undefined
                        ? { id: 'dir-bjj', name: 'БЖЖ' }
                        : o.direction,
                ),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                o.memberRole === null
                    ? null
                    : { role: { name: o.memberRole ?? 'coach' } },
            ),
        },
        directionManager: {
            findMany: jest.fn().mockResolvedValue([managerRow()]),
            create: o.createError
                ? jest.fn().mockRejectedValue(o.createError)
                : jest.fn(async (args: { data: { directionId: string; userId: string } }) =>
                      managerRow(args.data.directionId, args.data.userId),
                  ),
            findUnique: jest.fn().mockResolvedValue(managerRow()),
            findFirst: jest.fn().mockResolvedValue({
                id: 'dm-1',
                directionId: 'dir-bjj',
                userId: 'coach-1',
                direction: { name: 'БЖЖ' },
            }),
            delete: jest.fn().mockResolvedValue({}),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const r = rbac(o.admin ?? true)
    return { prisma, audit, rbac: r }
}

const assign = (b: ReturnType<typeof build>, userId = 'coach-1') =>
    new AssignDirectionManagerHandler(
        b.prisma as never,
        b.rbac as never,
        b.audit as never,
    ).execute(
        new AssignDirectionManagerFeature(
            { directionId: 'dir-bjj', userId },
            'w1',
            'admin-1',
            'admin',
            false,
        ),
    )

describe('listDirectionManagers', () => {
    it('lists the club assignments for an admin', async () => {
        const b = build()
        const out = await new ListDirectionManagersHandler(
            b.prisma as never,
            b.rbac as never,
        ).execute(new ListDirectionManagersFeature('w1', 'admin-1', 'admin', false))
        expect(b.prisma.directionManager.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
        })
        expect(out.data).toEqual([
            {
                id: 'dm-1',
                directionId: 'dir-bjj',
                userId: 'coach-1',
                email: 'c@club.ru',
                firstname: 'Иван',
                lastname: 'Петров',
                createdAt: CREATED.toISOString(),
            },
        ])
    })

    it('refuses a coach', async () => {
        const b = build({ admin: false })
        await expect(
            new ListDirectionManagersHandler(
                b.prisma as never,
                b.rbac as never,
            ).execute(new ListDirectionManagersFeature('w1', 'c', 'coach', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('assignDirectionManager', () => {
    it('assigns a coach and audits it', async () => {
        const b = build()
        const out = await assign(b)
        expect(b.prisma.directionManager.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            directionId: 'dir-bjj',
            userId: 'coach-1',
        })
        expect(out).toMatchObject({ directionId: 'dir-bjj', userId: 'coach-1' })
        expect(b.audit.record).toHaveBeenCalledWith({
            action: 'direction.managerAssign',
            targetType: 'direction',
            targetId: 'dir-bjj',
            workspaceId: 'w1',
            actorId: 'admin-1',
            metadata: { direction: 'БЖЖ', userId: 'coach-1' },
        })
    })

    it('refuses a coach as the assigner', async () => {
        const b = build({ admin: false })
        await expect(assign(b)).rejects.toBeInstanceOf(ForbiddenError)
        expect(b.prisma.directionManager.create).not.toHaveBeenCalled()
    })

    it('404s on a direction of another club', async () => {
        const b = build({ direction: null })
        await expect(assign(b)).rejects.toBeInstanceOf(NotFoundError)
        expect(b.prisma.direction.findFirst.mock.calls[0][0].where).toEqual({
            id: 'dir-bjj',
            workspaceId: 'w1',
        })
        expect(b.prisma.directionManager.create).not.toHaveBeenCalled()
    })

    it('404s on someone outside the club', async () => {
        const b = build({ memberRole: null })
        await expect(assign(b)).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each(['user', 'head_coach', 'admin'])(
        'refuses a member with role %s',
        async (memberRole) => {
            const b = build({ memberRole })
            await expect(assign(b)).rejects.toBeInstanceOf(BadRequestError)
            expect(b.prisma.directionManager.create).not.toHaveBeenCalled()
        },
    )

    it('refuses the owner, who already has every direction', async () => {
        const b = build({ memberRole: null })
        await expect(assign(b, 'owner-1')).rejects.toBeInstanceOf(BadRequestError)
    })

    it('is idempotent on a repeated assignment and does not audit twice', async () => {
        const b = build({ createError: { code: 'P2002' } })
        const out = await assign(b)
        expect(out.id).toBe('dm-1')
        expect(b.audit.record).not.toHaveBeenCalled()
    })
})

describe('removeDirectionManager', () => {
    const remove = (b: ReturnType<typeof build>) =>
        new RemoveDirectionManagerHandler(
            b.prisma as never,
            b.rbac as never,
            b.audit as never,
        ).execute(
            new RemoveDirectionManagerFeature('w1', 'dm-1', 'admin-1', 'admin', false),
        )

    it('removes the assignment and audits it', async () => {
        const b = build()
        await expect(remove(b)).resolves.toEqual({ status: 'deleted' })
        expect(b.prisma.directionManager.findFirst.mock.calls[0][0].where).toEqual({
            id: 'dm-1',
            workspaceId: 'w1',
        })
        expect(b.prisma.directionManager.delete).toHaveBeenCalledWith({
            where: { id: 'dm-1' },
        })
        expect(b.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'direction.managerRemove' }),
        )
    })

    it('404s on an assignment of another club', async () => {
        const b = build()
        b.prisma.directionManager.findFirst.mockResolvedValue(null)
        await expect(remove(b)).rejects.toBeInstanceOf(NotFoundError)
        expect(b.prisma.directionManager.delete).not.toHaveBeenCalled()
    })

    it('refuses a coach', async () => {
        const b = build({ admin: false })
        await expect(remove(b)).rejects.toBeInstanceOf(ForbiddenError)
    })
})
