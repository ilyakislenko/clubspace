import type { ThrottlerStorage } from '@nestjs/throttler'
import type Redis from 'ioredis'

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>

export const THROTTLE_KEY_PREFIX = 'throttle:'

// Fixed window per key, atomic in one round trip. Once the limit is crossed a
// separate block key holds the caller off for blockDuration; while it lives
// the hit counter is not bumped, mirroring the in-memory storage.
// Returns { totalHits, hitsTtlMs, isBlocked (0/1), blockTtlMs }.
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockMs = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
    local hits = tonumber(redis.call('GET', hitsKey) or '0')
    return { hits, math.max(redis.call('PTTL', hitsKey), 0), 1, blockTtl }
end

local hits = redis.call('INCR', hitsKey)
local hitsTtl = redis.call('PTTL', hitsKey)
if hitsTtl < 0 then
    redis.call('PEXPIRE', hitsKey, ttl)
    hitsTtl = ttl
end
if hits > limit then
    redis.call('SET', blockKey, '1', 'PX', blockMs)
    return { hits, hitsTtl, 1, blockMs }
end
return { hits, hitsTtl, 0, 0 }
`

/**
 * Rate-limit counters shared by every API replica. The default in-memory
 * store multiplied each limit by the replica count and reset on every deploy.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
    constructor(private readonly redis: Redis) {}

    async increment(
        key: string,
        ttl: number,
        limit: number,
        blockDuration: number,
        throttlerName: string,
    ): Promise<ThrottlerStorageRecord> {
        const base = `${THROTTLE_KEY_PREFIX}${throttlerName}:${key}`
        const [totalHits, hitsTtlMs, blocked, blockTtlMs] =
            (await this.redis.eval(
                INCREMENT_SCRIPT,
                2,
                `${base}:hits`,
                `${base}:block`,
                ttl,
                limit,
                // A zero block would make SET PX fail; fall back to the window.
                blockDuration > 0 ? blockDuration : ttl,
            )) as [number, number, number, number]
        return {
            totalHits,
            timeToExpire: Math.ceil(hitsTtlMs / 1000),
            isBlocked: blocked === 1,
            timeToBlockExpire: Math.ceil(blockTtlMs / 1000),
        }
    }
}
