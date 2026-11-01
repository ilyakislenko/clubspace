import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CreateDirectionFeature } from './create-direction.feature'
import { CreateDirectionHandler } from './create-direction.handler'
import { DeleteDirectionFeature } from './delete-direction.feature'
import { DeleteDirectionHandler } from './delete-direction.handler'
import { ListDirectionsFeature } from './list-directions.feature'
import { ListDirectionsHandler } from './list-directions.handler'
import { UpdateDirectionFeature } from './update-direction.feature'
import { UpdateDirectionHandler } from './update-direction.handler'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})
const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const realtime = () => ({ invalidate: jest.fn() })

const row = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    workspaceId: 'w1',
    name: 'БЖЖ',
    color: '#2563eb',
    icon: '🥋',
    order: 0,
    isActive: true,
    _count: { groups: 2 },
    ...over,
})

const noUsage = {
    groups: 0,
    rankLadders: 0,
    achievements: 0,
    plans: 0,
    events: 0,
    announcements: 0,
    courseAudiences: 0,
}

describe('listDirections', () => {
    const makePrisma = (ownerId = 'owner') => ({
        workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId }) },
        direction: {
            findMany: jest
                .fn()
                .mockResolvedValue([row(), row({ id: 'd2', name: 'ММА' })]),
        },
        groupMember: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ group: { directionId: 'd2' } }]),
        },
        groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    })

    it('shows a student the active directions and marks their own', async () => {
        const prisma = makePrisma()
        const out = await new ListDirectionsHandler(prisma as never).execute(
            new ListDirectionsFeature('w1', 'u1', 'user', false),
        )
        expect(prisma.direction.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            isActive: true,
        })
        expect(out.data.map((d) => [d.id, d.isMine, d.groupCount])).toEqual([
            ['d1', false, 2],
            ['d2', true, 2],
        ])
    })

    it.each([
        ['a coach', 'u1', 'coach', false],
        ['the owner without a role', 'owner', null, false],
        ['a super admin', 'u1', null, true],
    ])('shows %s archived directions too', async (_n, userId, role, superAdmin) => {
        const prisma = makePrisma()
        await new ListDirectionsHandler(prisma as never).execute(
            new ListDirectionsFeature('w1', userId, role, superAdmin),
        )
        expect(prisma.direction.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
        })
    })
})

describe('createDirection', () => {
    it('refuses a non-admin', async () => {
        const prisma = { direction: { create: jest.fn() } }
        await expect(
            new CreateDirectionHandler(
                prisma as never,
                rbac(false) as never,
                audit() as never,
                realtime() as never,
            ).execute(
                new CreateDirectionFeature({ name: 'БЖЖ' }, 'w1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.direction.create).not.toHaveBeenCalled()
    })

    it('appends to the end, audits and refreshes clients', async () => {
        const prisma = {
            direction: {
                count: jest.fn().mockResolvedValue(3),
                create: jest.fn().mockResolvedValue(row({ order: 3, _count: undefined })),
            },
        }
        const a = audit()
        const r = realtime()
        const out = await new CreateDirectionHandler(
            prisma as never,
            rbac() as never,
            a as never,
            r as never,
        ).execute(
            new CreateDirectionFeature(
                { name: 'БЖЖ', color: '', icon: '🥋' },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(prisma.direction.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            name: 'БЖЖ',
            color: null,
            icon: '🥋',
            order: 3,
            isActive: true,
        })
        expect(a.record.mock.calls[0][0]).toMatchObject({ action: 'direction.create' })
        expect(r.invalidate).toHaveBeenCalledWith('w1', ['directions'])
        expect(out).toMatchObject({ id: 'd1', order: 3, groupCount: 0, isMine: false })
    })
})

describe('updateDirection', () => {
    it('refuses a non-admin', async () => {
        const prisma = { direction: { findFirst: jest.fn() } }
        await expect(
            new UpdateDirectionHandler(
                prisma as never,
                rbac(false) as never,
                audit() as never,
                realtime() as never,
            ).execute(
                new UpdateDirectionFeature({ name: 'x' }, 'w1', 'd1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.direction.findFirst).not.toHaveBeenCalled()
    })

    it('404s a direction of another club', async () => {
        const prisma = {
            direction: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
        }
        await expect(
            new UpdateDirectionHandler(
                prisma as never,
                rbac() as never,
                audit() as never,
                realtime() as never,
            ).execute(
                new UpdateDirectionFeature({ name: 'x' }, 'w1', 'd9', 'u1', 'admin', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.direction.findFirst.mock.calls[0][0].where).toEqual({
            id: 'd9',
            workspaceId: 'w1',
        })
        expect(prisma.direction.update).not.toHaveBeenCalled()
    })

    it('archives and renames only the given fields', async () => {
        const prisma = {
            direction: {
                findFirst: jest.fn().mockResolvedValue({ id: 'd1' }),
                update: jest.fn().mockResolvedValue(row({ isActive: false })),
            },
        }
        const out = await new UpdateDirectionHandler(
            prisma as never,
            rbac() as never,
            audit() as never,
            realtime() as never,
        ).execute(
            new UpdateDirectionFeature(
                { isActive: false, icon: null },
                'w1',
                'd1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(prisma.direction.update.mock.calls[0][0].data).toEqual({
            icon: null,
            isActive: false,
        })
        expect(out.isActive).toBe(false)
    })
})

describe('deleteDirection', () => {
    const run = (prisma: unknown, admin = true) =>
        new DeleteDirectionHandler(
            prisma as never,
            rbac(admin) as never,
            audit() as never,
            realtime() as never,
        ).execute(new DeleteDirectionFeature('w1', 'd1', 'u1', 'admin', false))

    it('refuses a non-admin', async () => {
        const prisma = { direction: { findFirst: jest.fn() } }
        await expect(run(prisma, false)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.direction.findFirst).not.toHaveBeenCalled()
    })

    it('404s a direction of another club', async () => {
        const prisma = { direction: { findFirst: jest.fn().mockResolvedValue(null) } }
        await expect(run(prisma)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses while anything is tagged with it, naming what', async () => {
        const prisma = {
            direction: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'd1',
                    name: 'БЖЖ',
                    _count: { ...noUsage, groups: 2, announcements: 1 },
                }),
                delete: jest.fn(),
            },
        }
        await expect(run(prisma)).rejects.toThrow(BadRequestError)
        await expect(run(prisma)).rejects.toThrow(/группы: 2, объявления: 1/)
        expect(prisma.direction.delete).not.toHaveBeenCalled()
    })

    it('deletes an unused direction', async () => {
        const prisma = {
            direction: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'd1', name: 'БЖЖ', _count: noUsage }),
                delete: jest.fn().mockResolvedValue({}),
            },
        }
        await expect(run(prisma)).resolves.toEqual({ status: 'deleted' })
        expect(prisma.direction.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
    })
})
