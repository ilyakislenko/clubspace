import { CreateLadderFeature } from './create-ladder.feature'
import { CreateLadderHandler } from './create-ladder.handler'
import { DeleteLadderFeature } from './delete-ladder.feature'
import { DeleteLadderHandler } from './delete-ladder.handler'
import { DeleteLevelFeature } from './delete-level.feature'
import { DeleteLevelHandler } from './delete-level.handler'

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
