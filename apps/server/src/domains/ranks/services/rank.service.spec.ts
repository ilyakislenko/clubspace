import { RankService } from './rank.service'

const makePrisma = () => ({
    rankLevel: { findFirst: jest.fn() },
    rankPromotion: {
        create: jest
            .fn()
            .mockImplementation(({ data }) => ({ id: 'pr1', ...data })),
    },
})
const svcWith = (prisma: ReturnType<typeof makePrisma>) =>
    new RankService(prisma as never)

const base = {
    workspaceId: 'w1',
    userId: 'm1',
    ladderId: 'l1',
    levelId: 'lv1',
    awardedById: 'coach1',
}

describe('RankService.promote', () => {
    it('records a promotion when the level belongs to the ladder', async () => {
        const prisma = makePrisma()
        prisma.rankLevel.findFirst.mockResolvedValue({ id: 'lv1', maxStripes: 4 })
        await svcWith(prisma).promote({ ...base, stripes: 2, note: 'good work' })
        const data = prisma.rankPromotion.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: 'w1',
            userId: 'm1',
            ladderId: 'l1',
            levelId: 'lv1',
            stripes: 2,
            note: 'good work',
            awardedById: 'coach1',
        })
    })

    it('defaults stripes to 0', async () => {
        const prisma = makePrisma()
        prisma.rankLevel.findFirst.mockResolvedValue({ id: 'lv1', maxStripes: 4 })
        await svcWith(prisma).promote(base)
        expect(prisma.rankPromotion.create.mock.calls[0][0].data.stripes).toBe(0)
    })

    it('rejects stripes above the level max', async () => {
        const prisma = makePrisma()
        prisma.rankLevel.findFirst.mockResolvedValue({ id: 'lv1', maxStripes: 4 })
        await expect(
            svcWith(prisma).promote({ ...base, stripes: 5 }),
        ).rejects.toThrow(/от 0 до 4/i)
        expect(prisma.rankPromotion.create).not.toHaveBeenCalled()
    })

    it('404s a level that is not in the ladder/workspace', async () => {
        const prisma = makePrisma()
        prisma.rankLevel.findFirst.mockResolvedValue(null)
        await expect(svcWith(prisma).promote(base)).rejects.toThrow(
            /Ранг не найден/i,
        )
    })
})

describe('RankService.promoteMany', () => {
    const many = {
        workspaceId: 'w1',
        userIds: ['m1', 'm2'],
        ladderId: 'l1',
        levelId: 'lv1',
        awardedById: 'coach1',
    }
    const withTx = () => {
        const prisma = {
            ...makePrisma(),
            $transaction: jest
                .fn()
                .mockImplementation(async (ops: unknown[]) => Promise.all(ops)),
        }
        return prisma
    }

    it('validates the level once and writes every row in one transaction', async () => {
        const prisma = withTx()
        prisma.rankLevel.findFirst.mockResolvedValue({ id: 'lv1', maxStripes: 4 })
        const out = await new RankService(prisma as never).promoteMany({
            ...many,
            stripes: 1,
        })
        expect(prisma.rankLevel.findFirst).toHaveBeenCalledTimes(1)
        expect(prisma.$transaction).toHaveBeenCalledTimes(1)
        expect(prisma.rankPromotion.create).toHaveBeenCalledTimes(2)
        expect(
            prisma.rankPromotion.create.mock.calls.map(
                (c: [{ data: { userId: string; stripes: number } }]) => [
                    c[0].data.userId,
                    c[0].data.stripes,
                ],
            ),
        ).toEqual([
            ['m1', 1],
            ['m2', 1],
        ])
        expect(out).toHaveLength(2)
    })

    it('writes nothing when the level is not in the ladder/workspace', async () => {
        const prisma = withTx()
        prisma.rankLevel.findFirst.mockResolvedValue(null)
        await expect(
            new RankService(prisma as never).promoteMany(many),
        ).rejects.toThrow(/Ранг не найден/i)
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(prisma.rankPromotion.create).not.toHaveBeenCalled()
    })

    it('writes nothing when stripes exceed the level cap', async () => {
        const prisma = withTx()
        prisma.rankLevel.findFirst.mockResolvedValue({ id: 'lv1', maxStripes: 2 })
        await expect(
            new RankService(prisma as never).promoteMany({ ...many, stripes: 3 }),
        ).rejects.toThrow(/от 0 до 2/i)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })
})
