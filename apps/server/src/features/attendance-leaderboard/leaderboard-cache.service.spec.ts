import { LeaderboardCacheService } from './leaderboard-cache.service'

const board = {
    ranked: [{ userId: 'a', name: 'Ann', checkins: 3, rank: 1 }],
    counts: { a: 3 },
    hiddenUserIds: [],
}

const makeRedis = (cached: string | null = null) => ({
    hget: jest.fn().mockResolvedValue(cached),
    hset: jest.fn().mockResolvedValue(1),
    pexpire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
})

const DIR = '11111111-1111-4111-8111-111111111111'

describe('LeaderboardCacheService', () => {
    it('serves a fresh cached board without computing', async () => {
        const redis = makeRedis(JSON.stringify({ at: Date.now(), board }))
        const compute = jest.fn()
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'week', null, compute)
        expect(out).toEqual(board)
        expect(redis.hget).toHaveBeenCalledWith('leaderboard:w1', 'week:all')
        expect(compute).not.toHaveBeenCalled()
    })

    it('recomputes over an entry older than the TTL', async () => {
        const redis = makeRedis(
            JSON.stringify({ at: Date.now() - 10 * 60_000, board: { stale: 1 } }),
        )
        const compute = jest.fn().mockResolvedValue(board)
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'week', null, compute)
        expect(out).toEqual(board)
        expect(compute).toHaveBeenCalledTimes(1)
    })

    it('computes on a miss and stores the board in the club hash with a TTL', async () => {
        const redis = makeRedis()
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'month', DIR, async () => board)
        expect(out).toEqual(board)
        expect(redis.hget).toHaveBeenCalledWith('leaderboard:w1', `month:${DIR}`)
        const [k, f, value] = redis.hset.mock.calls[0]
        expect([k, f]).toEqual(['leaderboard:w1', `month:${DIR}`])
        expect(JSON.parse(value)).toEqual({ at: expect.any(Number), board })
        expect(redis.pexpire).toHaveBeenCalledWith(
            'leaderboard:w1',
            expect.any(Number),
        )
    })

    it('falls back to the database when Redis fails', async () => {
        const redis = makeRedis()
        redis.hget.mockRejectedValue(new Error('down'))
        redis.hset.mockRejectedValue(new Error('down'))
        const out = await new LeaderboardCacheService(
            redis as never,
        ).getOrCompute('w1', 'week', null, async () => board)
        expect(out).toEqual(board)
    })

    it('drops every period and direction of the club on invalidate, swallowing Redis errors', async () => {
        const redis = makeRedis()
        const cache = new LeaderboardCacheService(redis as never)
        await cache.invalidate('w1')
        expect(redis.del).toHaveBeenCalledWith('leaderboard:w1')
        redis.del.mockRejectedValue(new Error('down'))
        await expect(cache.invalidate('w1')).resolves.toBeUndefined()
    })
})
