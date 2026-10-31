import { LeaderboardCacheService } from './leaderboard-cache.service'

const board = {
    ranked: [{ userId: 'a', name: 'Ann', checkins: 3, rank: 1 }],
    counts: { a: 3 },
    hiddenUserIds: [],
}

const makeRedis = (cached: string | null = null) => ({
    get: jest.fn().mockResolvedValue(cached),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(2),
})

describe('LeaderboardCacheService', () => {
    it('serves a cached board without computing', async () => {
        const redis = makeRedis(JSON.stringify(board))
        const compute = jest.fn()
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'week', compute)
        expect(out).toEqual(board)
        expect(redis.get).toHaveBeenCalledWith('leaderboard:w1:week')
        expect(compute).not.toHaveBeenCalled()
    })

    it('computes on a miss and stores the board with a TTL', async () => {
        const redis = makeRedis()
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'month', async () => board)
        expect(out).toEqual(board)
        expect(redis.set).toHaveBeenCalledWith(
            'leaderboard:w1:month',
            JSON.stringify(board),
            'PX',
            expect.any(Number),
        )
    })

    it('falls back to the database when Redis fails', async () => {
        const redis = makeRedis()
        redis.get.mockRejectedValue(new Error('down'))
        redis.set.mockRejectedValue(new Error('down'))
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'week', async () => board)
        expect(out).toEqual(board)
    })

    it('drops every period of the club on invalidate, swallowing Redis errors', async () => {
        const redis = makeRedis()
        const cache = new LeaderboardCacheService(redis as never)
        await cache.invalidate('w1')
        expect(redis.del).toHaveBeenCalledWith(
            'leaderboard:w1:week',
            'leaderboard:w1:month',
        )
        redis.del.mockRejectedValue(new Error('down'))
        await expect(cache.invalidate('w1')).resolves.toBeUndefined()
    })
})
