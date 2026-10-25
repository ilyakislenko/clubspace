import { GetMyRanksFeature } from './get-my-ranks.feature'
import { GetMyRanksHandler } from './get-my-ranks.handler'

const promo = (over: Record<string, unknown> = {}) => ({
    id: 'p',
    ladderId: 'l1',
    ladder: { name: 'Adults' },
    levelId: 'lv',
    level: { name: 'Blue', color: null },
    stripes: 0,
    note: null,
    awardedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
})

describe('getMyRanks', () => {
    it('returns latest promotion per ladder as current + full history, scoped to me', async () => {
        const prisma = {
            rankPromotion: {
                findMany: jest.fn().mockResolvedValue([
                    promo({ id: 'p3', ladderId: 'l1', awardedAt: new Date('2026-07-03Z') }),
                    promo({ id: 'p2', ladderId: 'l2', ladder: { name: 'Kids' }, awardedAt: new Date('2026-06-01Z') }),
                    promo({ id: 'p1', ladderId: 'l1', awardedAt: new Date('2026-01-01Z') }),
                ]),
            },
        }
        const out = await new GetMyRanksHandler(prisma as never).execute(
            new GetMyRanksFeature('w1', 'me'),
        )
        expect(out.history).toHaveLength(3)
        expect(out.current.map((c) => c.id)).toEqual(['p3', 'p2'])
        expect(prisma.rankPromotion.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'me',
        })
    })

    it('names who awarded the rank, except a deleted account', async () => {
        const prisma = {
            rankPromotion: {
                findMany: jest.fn().mockResolvedValue([
                    promo({
                        id: 'p2',
                        awardedBy: { firstname: 'Иван', lastname: 'Петров', status: 'ACTIVE' },
                    }),
                    promo({
                        id: 'p1',
                        awardedBy: { firstname: 'Анна', lastname: null, status: 'DELETED' },
                    }),
                    promo({
                        id: 'p0',
                        awardedBy: { firstname: null, lastname: ' ', status: 'ACTIVE' },
                    }),
                ]),
            },
        }
        const out = await new GetMyRanksHandler(prisma as never).execute(
            new GetMyRanksFeature('w1', 'me'),
        )
        expect(out.history.map((h) => h.awardedByName)).toEqual(['Иван Петров', null, null])
        expect(
            prisma.rankPromotion.findMany.mock.calls[0][0].include.awardedBy,
        ).toBeDefined()
    })
})
