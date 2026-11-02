import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ListAchievementsFeature } from './list-achievements.feature'
import { ListAchievementsHandler } from './list-achievements.handler'
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

const rbac = (admin = true, managed: string[] = []) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
    // Mirrors RbacService: admin passes; else every named direction must be
    // managed, null (club-wide) or nothing named is refused.
    assertCanManageDirection: jest.fn(
        async (_ctx: unknown, ...ids: Array<string | null | undefined>) => {
            if (admin) return
            const named = ids.filter((d) => d !== undefined)
            if (
                named.length === 0 ||
                named.some((d) => d === null || !managed.includes(d))
            ) {
                throw new ForbiddenError({
                    message: 'Нужны права администратора клуба',
                })
            }
        },
    ),
    assertManagesDirections: jest.fn(async () => {
        if (admin) return null
        if (managed.length === 0) {
            throw new ForbiddenError({
                message: 'Нужны права администратора клуба',
            })
        }
        return managed
    }),
})

const DIR = '11111111-1111-4111-8111-111111111111'

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
    directionId: null,
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

    it('tags a direction of this club', async () => {
        const create = jest
            .fn()
            .mockResolvedValue(dbRow({ directionId: DIR }))
        const findFirst = jest.fn().mockResolvedValue({ id: DIR })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { achievement: { create }, direction: { findFirst } }
        const out = await new CreateAchievementHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new CreateAchievementFeature(
                { name: 'x', metric: 'CHECKINS', threshold: 5, directionId: DIR },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(findFirst.mock.calls[0][0].where).toEqual({
            id: DIR,
            workspaceId: 'w1',
        })
        expect(create.mock.calls[0][0].data.directionId).toBe(DIR)
        expect(out.directionId).toBe(DIR)
    })

    it('404s a direction of another club', async () => {
        const create = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: { create },
            direction: { findFirst: jest.fn().mockResolvedValue(null) },
        }
        await expect(
            new CreateAchievementHandler(prisma, rbac(true) as never).execute(
                new CreateAchievementFeature(
                    { name: 'x', metric: 'CHECKINS', threshold: 5, directionId: DIR },
                    'w1',
                    'u1',
                    'admin',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(create).not.toHaveBeenCalled()
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
        ).rejects.toThrow(/администратор/i)
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

    it('moves an achievement to a direction, and back to club-wide', async () => {
        const update = jest.fn().mockResolvedValue(dbRow())
        const findFirst = jest.fn().mockResolvedValue({ id: DIR })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
                update,
            },
            direction: { findFirst },
        }
        const handler = new UpdateAchievementHandler(prisma, rbac(true) as never)
        await handler.execute(
            new UpdateAchievementFeature(
                { directionId: DIR },
                'w1',
                'a1',
                'u1',
                'admin',
                false,
            ),
        )
        await handler.execute(
            new UpdateAchievementFeature(
                { directionId: null },
                'w1',
                'a1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(update.mock.calls[0][0].data).toEqual({ directionId: DIR })
        expect(update.mock.calls[1][0].data).toEqual({ directionId: null })
        // null = club-wide needs no lookup.
        expect(findFirst).toHaveBeenCalledTimes(1)
    })

    it('404s a foreign direction without writing', async () => {
        const update = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
                update,
            },
            direction: { findFirst: jest.fn().mockResolvedValue(null) },
        }
        await expect(
            new UpdateAchievementHandler(prisma, rbac(true) as never).execute(
                new UpdateAchievementFeature(
                    { directionId: DIR },
                    'w1',
                    'a1',
                    'u1',
                    'admin',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(update).not.toHaveBeenCalled()
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
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
            workspace: {
                findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }),
            },
        }
        await new SeedDefaultAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new SeedDefaultAchievementsFeature({}, 'w1', 'u1', 'admin', false),
        )
        expect(createMany).toHaveBeenCalled()
        expect(createMany.mock.calls[0][0].data.length).toBeGreaterThan(0)
        expect(prisma.achievement.count.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            directionId: null,
        })
        expect(createMany.mock.calls[0][0].data[0].directionId).toBeNull()
    })

    it('seeds a direction ladder when only other scopes have achievements', async () => {
        const createMany = jest.fn().mockResolvedValue({ count: 7 })
        // The club-wide ladder exists; this direction has none yet.
        const count = jest.fn().mockResolvedValue(0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                count,
                createMany,
                findMany: jest.fn().mockResolvedValue([dbRow()]),
            },
            direction: { findFirst: jest.fn().mockResolvedValue({ id: DIR }) },
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
            workspace: {
                findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }),
            },
        }
        await new SeedDefaultAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new SeedDefaultAchievementsFeature(
                { directionId: DIR },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(count.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            directionId: DIR,
        })
        const data = createMany.mock.calls[0][0].data as Array<{
            directionId: string | null
        }>
        expect(data.length).toBeGreaterThan(0)
        expect(data.every((d) => d.directionId === DIR)).toBe(true)
    })

    it('is a no-op when that direction already has its ladder', async () => {
        const createMany = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                count: jest.fn().mockResolvedValue(2),
                createMany,
                findMany: jest.fn().mockResolvedValue([dbRow()]),
            },
            direction: { findFirst: jest.fn().mockResolvedValue({ id: DIR }) },
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
        }
        await new SeedDefaultAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new SeedDefaultAchievementsFeature(
                { directionId: DIR },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(createMany).not.toHaveBeenCalled()
    })

    it('404s a foreign direction', async () => {
        const count = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: { count, createMany: jest.fn() },
            direction: { findFirst: jest.fn().mockResolvedValue(null) },
        }
        await expect(
            new SeedDefaultAchievementsHandler(
                prisma,
                rbac(true) as never,
            ).execute(
                new SeedDefaultAchievementsFeature(
                    { directionId: DIR },
                    'w1',
                    'u1',
                    'admin',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(count).not.toHaveBeenCalled()
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
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
        }
        const out = await new SeedDefaultAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new SeedDefaultAchievementsFeature({}, 'w1', 'u1', 'admin', false),
        )
        expect(createMany).not.toHaveBeenCalled()
        expect(out.data.length).toBe(3)
    })
})

describe('listAchievements', () => {
    const rec = (userId: string, day: number, directionId: string | null) => ({
        userId,
        markedAt: new Date(Date.UTC(2026, 0, day, 10)),
        session: {
            group: directionId ? { directionId } : null,
            workspaceEvent: null,
        },
    })

    it('counts a direction achievement only on visits of that direction', async () => {
        const OTHER = '22222222-2222-4222-8222-222222222222'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findMany: jest.fn().mockResolvedValue([
                    dbRow({ id: 'club2', threshold: 2 }),
                    dbRow({ id: 'dir2', threshold: 2, directionId: DIR }),
                ]),
            },
            attendanceRecord: {
                findMany: jest.fn().mockResolvedValue([
                    // u1: 2 visits, both in DIR → both unlock.
                    rec('u1', 1, DIR),
                    rec('u1', 2, DIR),
                    // u2: 2 visits, one in DIR → only the club-wide one.
                    rec('u2', 1, DIR),
                    rec('u2', 2, OTHER),
                    // u3: 2 visits without a direction → only the club-wide one.
                    rec('u3', 1, null),
                    rec('u3', 2, null),
                ]),
            },
        }
        const out = await new ListAchievementsHandler(
            prisma,
            rbac(true) as never,
        ).execute(new ListAchievementsFeature('w1', 'u1', 'admin', false))
        const by = Object.fromEntries(out.data.map((a) => [a.id, a]))
        expect(by.club2.unlockedBy).toBe(3)
        expect(by.dir2.unlockedBy).toBe(1)
        expect(by.dir2.directionId).toBe(DIR)
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
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
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
        const findFirst = jest
            .fn()
            .mockResolvedValue({ id: 'a1', directionId: null })
        const del = jest.fn().mockResolvedValue({})
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { achievement: { findFirst, delete: del } }
        const out = await new DeleteAchievementHandler(
            prisma,
            rbac(true) as never,
        ).execute(
            new DeleteAchievementFeature('w1', 'a1', 'u1', 'admin', false),
        )
        expect(findFirst.mock.calls[0][0].where).toEqual({
            id: 'a1',
            workspaceId: 'w1',
        })
        expect(del).toHaveBeenCalledWith({ where: { id: 'a1' } })
        expect(out.status).toBe('deleted')
    })

    it('404s when nothing was deleted', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest.fn().mockResolvedValue(null),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeleteAchievementHandler(prisma, rbac(true) as never).execute(
                new DeleteAchievementFeature('w1', 'x', 'u1', 'admin', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('achievements as a direction manager', () => {
    const BJJ = DIR
    const MMA = '22222222-2222-4222-8222-222222222222'
    const coach = (payload: Record<string, unknown>) =>
        new UpdateAchievementFeature(payload, 'w1', 'a1', 'u1', 'coach', false)

    it('creates in a managed direction, refuses club-wide and others', async () => {
        const create = jest.fn().mockResolvedValue(dbRow({ directionId: BJJ }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: { create },
            direction: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
        }
        const r = rbac(false, [BJJ])
        const handler = new CreateAchievementHandler(prisma, r as never)
        const feature = (directionId?: string) =>
            new CreateAchievementFeature(
                { name: 'x', metric: 'CHECKINS', threshold: 5, directionId },
                'w1',
                'u1',
                'coach',
                false,
            )
        await handler.execute(feature(BJJ))
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            BJJ,
        )
        await expect(handler.execute(feature(MMA))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        await expect(handler.execute(feature())).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            null,
        )
        expect(create).toHaveBeenCalledTimes(1)
    })

    it('update checks current and target direction; refuses a move out', async () => {
        const update = jest.fn().mockResolvedValue(dbRow({ directionId: BJJ }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'a1', directionId: BJJ }),
                update,
            },
            direction: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
        }
        const r = rbac(false, [BJJ])
        const handler = new UpdateAchievementHandler(prisma, r as never)
        await handler.execute(coach({ threshold: 7 }))
        await expect(
            handler.execute(coach({ directionId: MMA })),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            BJJ,
            MMA,
        )
        await expect(
            handler.execute(coach({ directionId: null })),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(update).toHaveBeenCalledTimes(1)
    })

    it('refuses deleting a club-wide achievement', async () => {
        const del = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'a1', directionId: null }),
                delete: del,
            },
        }
        await expect(
            new DeleteAchievementHandler(
                prisma,
                rbac(false, [BJJ]) as never,
            ).execute(
                new DeleteAchievementFeature('w1', 'a1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(del).not.toHaveBeenCalled()
    })

    it('reorder passes every row direction; a club-wide one refuses', async () => {
        const updateMany = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: {
                findMany: jest
                    .fn()
                    .mockResolvedValue([{ directionId: BJJ }, { directionId: null }]),
                updateMany,
            },
            $transaction: jest.fn(),
        }
        const r = rbac(false, [BJJ])
        await expect(
            new ReorderAchievementsHandler(prisma, r as never).execute(
                new ReorderAchievementsFeature(
                    { ids: ['a', 'b'] },
                    'w1',
                    'u1',
                    'coach',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            BJJ,
            null,
        )
        expect(updateMany).not.toHaveBeenCalled()
    })

    it('seed: refuses a club-wide seed for a manager', async () => {
        const count = jest.fn()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { achievement: { count, createMany: jest.fn() } }
        await expect(
            new SeedDefaultAchievementsHandler(
                prisma,
                rbac(false, [BJJ]) as never,
            ).execute(
                new SeedDefaultAchievementsFeature({}, 'w1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(count).not.toHaveBeenCalled()
    })

    it('list: a manager sees only their directions; a plain coach is refused', async () => {
        const findMany = jest.fn().mockResolvedValue([])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            achievement: { findMany },
            attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
        }
        await new ListAchievementsHandler(
            prisma,
            rbac(false, [BJJ]) as never,
        ).execute(new ListAchievementsFeature('w1', 'u1', 'coach', false))
        expect(findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            directionId: { in: [BJJ] },
        })
        await expect(
            new ListAchievementsHandler(prisma, rbac(false) as never).execute(
                new ListAchievementsFeature('w1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
