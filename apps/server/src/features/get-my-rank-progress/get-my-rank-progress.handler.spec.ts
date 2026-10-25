import { GetMyRankProgressFeature } from './get-my-rank-progress.feature'
import { GetMyRankProgressHandler } from './get-my-rank-progress.handler'

const DAY = 86400000
const ago = (days: number) => new Date(Date.now() - days * DAY)

const LADDER = (over: object = {}) => ({
    id: 'l1',
    name: 'Взрослые',
    levels: [
        { id: 'white', name: 'Белый', color: null, order: 0, isActive: true, minVisits: null, minWeeks: null },
        { id: 'blue', name: 'Синий', color: '#00f', order: 1, isActive: true, minVisits: 10, minWeeks: 4 },
    ],
    ...over,
})

const make = (
    o: { promotions?: object[]; ladders?: object[]; pending?: object[]; visits?: number } = {},
) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
        },
        rankPromotion: { findMany: jest.fn().mockResolvedValue(o.promotions ?? []) },
        rankLadder: { findMany: jest.fn().mockResolvedValue(o.ladders ?? [LADDER()]) },
        rankGradingCandidate: { findMany: jest.fn().mockResolvedValue(o.pending ?? []) },
        attendanceRecord: { count: jest.fn().mockResolvedValue(o.visits ?? 0) },
    }
    const run = (userId = 'me') =>
        new GetMyRankProgressHandler(prisma as never).execute(
            new GetMyRankProgressFeature('w1', userId),
        )
    return { prisma, run }
}

const promo = (levelId: string, days: number, stripes = 0) => ({
    ladderId: 'l1',
    levelId,
    stripes,
    awardedAt: ago(days),
})

describe('getMyRankProgress', () => {
    it('returns nothing for a member without ranks', async () => {
        const { prisma, run } = make()
        expect(await run()).toEqual({ data: [] })
        expect(prisma.rankLadder.findMany).not.toHaveBeenCalled()
    })

    it('reports the rule, what is left and the visits since the level start', async () => {
        const { prisma, run } = make({
            promotions: [promo('white', 14, 2), promo('white', 21, 0)],
            visits: 4,
        })
        const out = await run()
        expect(out.data).toHaveLength(1)
        expect(out.data[0]).toMatchObject({
            ladderId: 'l1',
            ladderName: 'Взрослые',
            current: { levelName: 'Белый', stripes: 2 },
            nextLevel: { id: 'blue', name: 'Синий' },
            rule: { minVisits: 10, minWeeks: 4 },
            visitsSince: 4,
            weeksSince: 3,
            remainingVisits: 6,
            remainingWeeks: 1,
            ready: false,
            remainingText: 'ещё 6 тренировок и 1 неделя',
            upcomingGrading: null,
        })
        const since = prisma.attendanceRecord.count.mock.calls[0][0].where.markedAt.gte as Date
        expect(Math.round((Date.now() - since.getTime()) / DAY)).toBe(21)
    })

    it('is ready once the rule is met', async () => {
        const { run } = make({ promotions: [promo('white', 40)], visits: 12 })
        expect((await run()).data[0]).toMatchObject({ ready: true, remainingText: null })
    })

    it('has no next level at the top', async () => {
        const { run } = make({ promotions: [promo('blue', 40)] })
        expect((await run()).data[0]).toMatchObject({
            nextLevel: null,
            rule: null,
            ready: false,
        })
    })

    it('shows the upcoming grading with the level and gym', async () => {
        const { run } = make({
            promotions: [promo('white', 40)],
            pending: [
                {
                    level: { name: 'Синий' },
                    grading: {
                        id: 'gr1',
                        ladderId: 'l1',
                        date: new Date('2026-11-15T00:00:00Z'),
                        title: 'Осенняя аттестация',
                        gym: { name: 'Зал на Ленина' },
                    },
                },
            ],
        })
        expect((await run()).data[0].upcomingGrading).toEqual({
            gradingId: 'gr1',
            date: '2026-11-15',
            title: 'Осенняя аттестация',
            gymName: 'Зал на Ленина',
            levelName: 'Синий',
        })
    })

    it('drops an archived ladder (the query only asks for active ones)', async () => {
        const { prisma, run } = make({ promotions: [promo('white', 10)], ladders: [] })
        expect(await run()).toEqual({ data: [] })
        expect(prisma.rankLadder.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'w1',
            isActive: true,
        })
    })

    it('works for the owner: keyed on the user, never on a member row', async () => {
        const { prisma, run } = make({ promotions: [promo('white', 10)] })
        await run('owner1')
        expect(prisma.rankPromotion.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'owner1',
        })
    })
})
