import { NotFoundError } from '../../shared/errors/shared.errors'
import { CreateAchievementFeature } from './create-achievement.feature'
import { CreateAchievementHandler } from './create-achievement.handler'
import { DeleteAchievementFeature } from './delete-achievement.feature'
import { DeleteAchievementHandler } from './delete-achievement.handler'
import { SeedDefaultAchievementsFeature } from './seed-default-achievements.feature'
import { SeedDefaultAchievementsHandler } from './seed-default-achievements.handler'
import { ReorderAchievementsFeature } from './reorder-achievements.feature'
import { ReorderAchievementsHandler } from './reorder-achievements.handler'
import { UpdateAchievementFeature } from './update-achievement.feature'
import { UpdateAchievementHandler } from './update-achievement.handler'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const dbRow = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    workspaceId: 'w1',
    name: '50 тренировок',
    description: null,
    icon: '🥋',
    metric: 'CHECKINS',
    threshold: 50,
    isActive: true,
    order: 0,
    ...over,
})

describe('createAchievement', () => {
    it('creates when admin, blanking empty description/icon', async () => {
        const create = jest.fn().mockResolvedValue(dbRow())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { achievement: { create } }
        const out = await new CreateAchievementHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new CreateAchievementFeature(
                { name: '50 тренировок', metric: 'CHECKINS', threshold: 50, icon: '  ' },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(create.mock.calls[0][0].data).toMatchObject({
            workspaceId: 'w1',
            threshold: 50,
            icon: null,
        })
        expect(out).toMatchObject({ id: 'a1', metric: 'CHECKINS' })
    })

    it('forbids a non-admin', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { achievement: { create: jest.fn() } }
        await expect(
            new CreateAchievementHandler(prisma, rbac(false) as never).execute(
                new CreateAchievementFeature(
                    { name: 'x', metric: 'CHECKINS', threshold: 5 },
                    'w1',
                    'u1',
                    'coach',
                    false,
                ),
            ),
        ).rejects.toThrow(/admin/i)
        expect(prisma.achievement.create).not.toHaveBeenCalled()
    })
})

describe('updateAchievement', () => {
    it('updates an owned achievement scoped to the workspace', async () => {
        const update = jest.fn().mockResolvedValue(dbRow({ threshold: 60 }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
                update,
            },
        }
        const out = await new UpdateAchievementHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new UpdateAchievementFeature(
                { threshold: 60 },
                'w1',
                'a1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(update.mock.calls[0][0].data).toEqual({ threshold: 60 })
        expect(out.threshold).toBe(60)
    })

    it('404s a missing / foreign achievement', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest.fn().mockResolvedValue(null),
                update: jest.fn(),
            },
        }
        await expect(
            new UpdateAchievementHandler(prisma, rbac(true) as never).execute(
                new UpdateAchievementFeature(
                    { threshold: 60 },
                    'w1',
                    'nope',
                    'u1',
                    'admin',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('seedDefaultAchievements', () => {
    it('seeds the default ladder into an empty workspace', async () => {
        const createMany = jest.fn().mockResolvedValue({ count: 7 })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                count: jest.fn().mockResolvedValue(0),
                createMany,
                findMany: jest.fn().mockResolvedValue([dbRow()]),
            },
        }
        await new SeedDefaultAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new SeedDefaultAchievementsFeature('w1', 'u1', 'admin', false),
        )
        expect(createMany).toHaveBeenCalled()
        expect(createMany.mock.calls[0][0].data.length).toBeGreaterThan(0)
    })

    it('is a no-op when the club already has achievements', async () => {
        const createMany = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                count: jest.fn().mockResolvedValue(3),
                createMany,
                findMany: jest.fn().mockResolvedValue([dbRow(), dbRow(), dbRow()]),
            },
        }
        const out = await new SeedDefaultAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new SeedDefaultAchievementsFeature('w1', 'u1', 'admin', false),
        )
        expect(createMany).not.toHaveBeenCalled()
        expect(out.data.length).toBe(3)
    })
})

describe('reorderAchievements', () => {
    it('writes order = position for each id, workspace-scoped', async () => {
        const updateMany = jest.fn().mockReturnValue('op')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                updateMany,
                findMany: jest.fn().mockResolvedValue([dbRow()]),
            },
            $transaction: jest.fn().mockResolvedValue([]),
        }
        await new ReorderAchievementsHandler(prisma, rbac(true) as never).execute(
            new ReorderAchievementsFeature(
                { ids: ['a', 'b', 'c'] },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(updateMany).toHaveBeenNthCalledWith(1, {
            where: { id: 'a', workspaceId: 'w1' },
            data: { order: 0 },
        })
        expect(updateMany).toHaveBeenNthCalledWith(3, {
            where: { id: 'c', workspaceId: 'w1' },
            data: { order: 2 },
        })
    })
})

describe('deleteAchievement', () => {
    it('deletes scoped to the workspace', async () => {
        const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { achievement: { deleteMany } }
        const out = await new DeleteAchievementHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new DeleteAchievementFeature('w1', 'a1', 'u1', 'admin', false),
        )
        expect(deleteMany).toHaveBeenCalledWith({
            where: { id: 'a1', workspaceId: 'w1' },
        })
        expect(out.status).toBe('deleted')
    })

    it('404s when nothing was deleted', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        }
        await expect(
            new DeleteAchievementHandler(prisma, rbac(true) as never).execute(
                new DeleteAchievementFeature('w1', 'x', 'u1', 'admin', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
