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
        ).rejects.toThrow(/between 0 and 4/i)
        expect(prisma.rankPromotion.create).not.toHaveBeenCalled()
    })

    it('404s a level that is not in the ladder/workspace', async () => {
        const prisma = makePrisma()
        prisma.rankLevel.findFirst.mockResolvedValue(null)
        await expect(svcWith(prisma).promote(base)).rejects.toThrow(
            /level not found/i,
        )
    })
})
