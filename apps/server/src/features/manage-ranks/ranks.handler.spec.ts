import { CreateLevelFeature } from './create-level.feature'
import { CreateLevelHandler } from './create-level.handler'
import { CreateLadderFeature } from './create-ladder.feature'
import { CreateLadderHandler } from './create-ladder.handler'
import { DeleteLadderFeature } from './delete-ladder.feature'
import { DeleteLadderHandler } from './delete-ladder.handler'
import { DeleteLevelFeature } from './delete-level.feature'
import { DeleteLevelHandler } from './delete-level.handler'
import { UpdateLevelFeature } from './update-level.feature'
import { UpdateLevelHandler } from './update-level.handler'

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
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
                    .mockResolvedValue({ id: 'lv1', _count: { promotions: 1 } }),
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
                findFirst: jest.fn().mockResolvedValue({ id: 'lv1' }),
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
