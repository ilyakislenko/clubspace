import { RedisThrottlerStorage } from './redis-throttler.storage'

const makeRedis = (reply: [number, number, number, number]) => ({
    eval: jest.fn().mockResolvedValue(reply),
})

describe('RedisThrottlerStorage', () => {
    it('counts a hit under the throttler-scoped keys', async () => {
        const redis = makeRedis([1, 60_000, 0, 0])
        const out = await new RedisThrottlerStorage(redis as never).increment(
            'k',
            60_000,
            10,
            30_000,
            'default',
        )
        expect(redis.eval).toHaveBeenCalledWith(
            expect.any(String),
            2,
            'throttle:default:k:hits',
            'throttle:default:k:block',
            60_000,
            10,
            30_000,
        )
        expect(out).toEqual({
            totalHits: 1,
            timeToExpire: 60,
            isBlocked: false,
            timeToBlockExpire: 0,
        })
    })

    it('reports a block with its remaining time in seconds', async () => {
        const redis = makeRedis([11, 1_500, 1, 29_001])
        const out = await new RedisThrottlerStorage(redis as never).increment(
            'k',
            60_000,
            10,
            30_000,
            'short',
        )
        expect(out).toEqual({
            totalHits: 11,
            timeToExpire: 2,
            isBlocked: true,
            timeToBlockExpire: 30,
        })
    })

    it('falls back to the window when no block duration is set', async () => {
        const redis = makeRedis([1, 1_000, 0, 0])
        await new RedisThrottlerStorage(redis as never).increment(
            'k',
            1_000,
            5,
            0,
            'short',
        )
        expect(redis.eval.mock.calls[0][6]).toBe(1_000)
    })
})
