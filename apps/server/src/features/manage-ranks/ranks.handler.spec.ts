import { CreateLevelFeature } from './create-level.feature'
import { CreateLevelHandler } from './create-level.handler'
import { CreateLadderFeature } from './create-ladder.feature'
import { CreateLadderHandler } from './create-ladder.handler'
import { DeleteLadderFeature } from './delete-ladder.feature'
import { DeleteLadderHandler } from './delete-ladder.handler'
import { DeleteLevelFeature } from './delete-level.feature'
import { DeleteLevelHandler } from './delete-level.handler'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListLaddersFeature } from './list-ladders.feature'
import { ListLaddersHandler } from './list-ladders.handler'
import { UpdateLadderFeature } from './update-ladder.feature'
import { UpdateLadderHandler } from './update-ladder.handler'
import { UpdateLevelFeature } from './update-level.feature'
import { UpdateLevelHandler } from './update-level.handler'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
    assertCanManageDirection: admin
        ? jest.fn().mockResolvedValue(undefined)
        : jest
              .fn()
              .mockRejectedValue(
                  new ForbiddenError({ message: 'Нужны права администратора клуба' }),
              ),
    assertManagesDirections: admin
        ? jest.fn().mockResolvedValue(null)
        : jest
              .fn()
              .mockRejectedValue(
                  new ForbiddenError({ message: 'Нужны права администратора клуба' }),
              ),
})

// A coach who runs the BJJ direction.
const manager = () => ({
    resolveCoachScope: jest.fn().mockResolvedValue({ scope: 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(false),
    assertCanManageDirection: jest.fn().mockResolvedValue(undefined),
    assertManagesDirections: jest.fn().mockResolvedValue(['dir-bjj']),
})

describe('direction manager on ladders', () => {
    const ladderRow = {
        id: 'l1',
        workspaceId: 'w1',
        name: 'BJJ',
        audience: null,
        isActive: true,
        order: 0,
        directionId: 'dir-bjj',
        levels: [],
    }

    it('creates a ladder in a managed direction', async () => {
        const prisma = {
            direction: {
                findFirst: jest.fn().mockResolvedValue({ id: 'dir-bjj' }),
            },
            rankLadder: { create: jest.fn().mockResolvedValue(ladderRow) },
        }
        const r = manager()
        await new CreateLadderHandler(prisma as never, r as never).execute(
            new CreateLadderFeature(
                { name: 'BJJ', directionId: 'dir-bjj' },
                'w1',
                'u1',
                'coach',
                false,
            ),
        )
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            'dir-bjj',
        )
        expect(prisma.rankLadder.create).toHaveBeenCalled()
    })

    it('checks a club-wide create as null', async () => {
        const prisma = { rankLadder: { create: jest.fn() } }
        const r = manager()
        r.assertCanManageDirection.mockRejectedValue(
            new ForbiddenError({ message: 'Нужны права администратора клуба' }),
        )
        await expect(
            new CreateLadderHandler(prisma as never, r as never).execute(
                new CreateLadderFeature({ name: 'x' }, 'w1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            null,
        )
        expect(prisma.rankLadder.create).not.toHaveBeenCalled()
    })

    it('checks current and target direction on a move', async () => {
        const prisma = {
            direction: {
                findFirst: jest.fn().mockResolvedValue({ id: 'dir-mma' }),
            },
            rankLadder: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'l1', directionId: 'dir-bjj' }),
                update: jest.fn().mockResolvedValue(ladderRow),
            },
        }
        const r = manager()
        r.assertCanManageDirection.mockRejectedValue(
            new ForbiddenError({ message: 'Нет прав' }),
        )
        await expect(
            new UpdateLadderHandler(prisma as never, r as never).execute(
                new UpdateLadderFeature(
                    { directionId: 'dir-mma' },
                    'w1',
                    'l1',
                    'u1',
                    'coach',
                    false,
                ),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            'dir-bjj',
            'dir-mma',
        )
        expect(prisma.rankLadder.update).not.toHaveBeenCalled()
    })

    it('refuses deleting a ladder outside managed directions', async () => {
        const prisma = {
            rankLadder: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'l1',
                    directionId: 'dir-mma',
                    _count: { promotions: 0, gradings: 0 },
                }),
                delete: jest.fn(),
            },
        }
        const r = manager()
        r.assertCanManageDirection.mockRejectedValue(
            new ForbiddenError({ message: 'Нет прав' }),
        )
        await expect(
            new DeleteLadderHandler(prisma as never, r as never).execute(
                new DeleteLadderFeature('w1', 'l1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            'dir-mma',
        )
        expect(prisma.rankLadder.delete).not.toHaveBeenCalled()
    })

    it('lists only managed directions', async () => {
        const prisma = {
            rankLadder: { findMany: jest.fn().mockResolvedValue([ladderRow]) },
        }
        await new ListLaddersHandler(prisma as never, manager() as never).execute(
            new ListLaddersFeature({}, 'w1', 'u1', 'coach', false),
        )
        expect(prisma.rankLadder.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'w1',
            directionId: { in: ['dir-bjj'] },
        })
    })

    it('lists unfiltered for admin', async () => {
        const prisma = {
            rankLadder: { findMany: jest.fn().mockResolvedValue([]) },
        }
        await new ListLaddersHandler(prisma as never, rbac(true) as never).execute(
            new ListLaddersFeature({}, 'w1', 'u1', 'admin', false),
        )
        expect(
            prisma.rankLadder.findMany.mock.calls[0][0].where.directionId,
        ).toBeUndefined()
    })

    it('checks the parent ladder direction for a level', async () => {
        const prisma = {
            rankLadder: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'l1', directionId: 'dir-bjj' }),
            },
            rankLevel: { create: jest.fn() },
        }
        const r = manager()
        r.assertCanManageDirection.mockRejectedValue(
            new ForbiddenError({ message: 'Нет прав' }),
        )
        await expect(
            new CreateLevelHandler(prisma as never, r as never).execute(
                new CreateLevelFeature({ name: 'x', order: 1 }, 'w1', 'l1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenCalledWith(
            expect.anything(),
            'dir-bjj',
        )
        expect(prisma.rankLevel.create).not.toHaveBeenCalled()
    })
})

describe('createRankLadder', () => {
    it('creates when admin', async () => {
        const prisma = {
            rankLadder: {
                create: jest.fn().mockResolvedValue({
                    id: 'l1',
                    workspaceId: 'w1',
                    name: 'Adults',
                    audience: 'adult',
                    isActive: true,
                    order: 0,
                    levels: [],
                }),
            },
        }
        const out = await new CreateLadderHandler(
            prisma as never,
            rbac(true) as never,
        ).execute(
            new CreateLadderFeature(
                { name: 'Adults', audience: 'adult' },
                'w1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(out).toMatchObject({ id: 'l1', name: 'Adults', levels: [] })
    })

    it('forbids a non-admin', async () => {
        const prisma = { rankLadder: { create: jest.fn() } }
        await expect(
            new CreateLadderHandler(prisma as never, rbac(false) as never).execute(
                new CreateLadderFeature({ name: 'x' }, 'w1', 'u1', 'coach', false),
            ),
        ).rejects.toThrow(/администратор/i)
        expect(prisma.rankLadder.create).not.toHaveBeenCalled()
    })
})

describe('deleteRankLadder', () => {
    it('blocks delete when the ladder has promotions', async () => {
        const prisma = {
            rankLadder: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'l1', _count: { promotions: 2 } }),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeleteLadderHandler(prisma as never, rbac(true) as never).execute(
                new DeleteLadderFeature('w1', 'l1', 'u1', 'admin', false),
            ),
        ).rejects.toThrow(/архив/i)
        expect(prisma.rankLadder.delete).not.toHaveBeenCalled()
    })
})

describe('deleteRankLevel', () => {
    it('blocks delete when the level has promotions', async () => {
        const prisma = {
            rankLevel: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({
                        id: 'lv1',
                        ladder: { directionId: null },
                        _count: { promotions: 1 },
                    }),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeleteLevelHandler(prisma as never, rbac(true) as never).execute(
                new DeleteLevelFeature('w1', 'l1', 'lv1', 'u1', 'admin', false),
            ),
        ).rejects.toThrow(/архив/i)
        expect(prisma.rankLevel.delete).not.toHaveBeenCalled()
    })
})

describe('deleteRankLadder / deleteRankLevel grading guards', () => {
    it('blocks deleting a ladder that has gradings', async () => {
        const prisma = {
            rankLadder: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'l1',
                    _count: { promotions: 0, gradings: 1 },
                }),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeleteLadderHandler(prisma as never, rbac(true) as never).execute(
                new DeleteLadderFeature('w1', 'l1', 'u1', 'admin', false),
            ),
        ).rejects.toThrow(/аттестации/i)
        expect(prisma.rankLadder.delete).not.toHaveBeenCalled()
    })

    it('blocks deleting a level used by a grading candidate', async () => {
        const prisma = {
            rankLevel: {
                findFirst: jest.fn().mockResolvedValue({
                    ladder: { directionId: null },
                    id: 'lv1',
                    _count: { promotions: 0, gradingCandidates: 2 },
                }),
                delete: jest.fn(),
            },
        }
        await expect(
            new DeleteLevelHandler(prisma as never, rbac(true) as never).execute(
                new DeleteLevelFeature('w1', 'l1', 'lv1', 'u1', 'admin', false),
            ),
        ).rejects.toThrow(/аттестации/i)
        expect(prisma.rankLevel.delete).not.toHaveBeenCalled()
    })
})

describe('level grading rule fields', () => {
    const row = (o: object = {}) => ({
        id: 'lv1',
        ladderId: 'l1',
        name: 'Синий',
        order: 1,
        color: null,
        maxStripes: 0,
        requirements: null,
        minVisits: null,
        minWeeks: null,
        isActive: true,
        ...o,
    })

    it('persists minVisits/minWeeks on create', async () => {
        const prisma = {
            rankLadder: { findFirst: jest.fn().mockResolvedValue({ id: 'l1' }) },
            rankLevel: {
                create: jest
                    .fn()
                    .mockImplementation(({ data }) => Promise.resolve(row(data))),
            },
        }
        const out = await new CreateLevelHandler(
            prisma as never,
            rbac(true) as never,
        ).execute(
            new CreateLevelFeature(
                { name: 'Синий', order: 1, minVisits: 40, minWeeks: 16 },
                'w1',
                'l1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(prisma.rankLevel.create.mock.calls[0][0].data).toMatchObject({
            minVisits: 40,
            minWeeks: 16,
        })
        expect(out).toMatchObject({ minVisits: 40, minWeeks: 16 })
    })

    it('defaults the rule to null on create', async () => {
        const prisma = {
            rankLadder: { findFirst: jest.fn().mockResolvedValue({ id: 'l1' }) },
            rankLevel: {
                create: jest
                    .fn()
                    .mockImplementation(({ data }) => Promise.resolve(row(data))),
            },
        }
        await new CreateLevelHandler(prisma as never, rbac(true) as never).execute(
            new CreateLevelFeature({ name: 'Синий', order: 1 }, 'w1', 'l1', 'u1', 'admin', false),
        )
        expect(prisma.rankLevel.create.mock.calls[0][0].data).toMatchObject({
            minVisits: null,
            minWeeks: null,
        })
    })

    it('sets and clears the rule on update, leaving untouched fields out', async () => {
        const prisma = {
            rankLevel: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 'lv1', ladder: { directionId: null } }),
                update: jest.fn().mockResolvedValue(row()),
            },
        }
        const handler = new UpdateLevelHandler(prisma as never, rbac(true) as never)
        await handler.execute(
            new UpdateLevelFeature({ minVisits: 30 }, 'w1', 'l1', 'lv1', 'u1', 'admin', false),
        )
        expect(prisma.rankLevel.update.mock.calls[0][0].data).toEqual({
            minVisits: 30,
        })
        await handler.execute(
            new UpdateLevelFeature(
                { minVisits: null, minWeeks: null },
                'w1',
                'l1',
                'lv1',
                'u1',
                'admin',
                false,
            ),
        )
        expect(prisma.rankLevel.update.mock.calls[1][0].data).toEqual({
            minVisits: null,
            minWeeks: null,
        })
    })
})
