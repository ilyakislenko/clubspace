jest.mock('./call-list', () => ({ loadCallList: jest.fn() }))

import { Logger } from '@nestjs/common'

import { BackgroundTasks } from '../../infrastructure/prisma/background-tasks'
import { loadCallList } from './call-list'
import { CACHE_WAIT_MS, CALL_LIST_TTL_MS, CallListCacheService } from './call-list-cache.service'

const LIST = { scoredAt: null, entries: [{ userId: 'a' }] }
const FRESH = { scoredAt: null, entries: [{ userId: 'b' }] }

// A tiny in-memory Redis: get/set/del, and `eval` running the one script the
// service sends (store unless dropped since the computation started).
const makeRedis = () => {
    const store = new Map<string, string>()
    return {
        store,
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
            store.set(k, v)
            return 'OK'
        }),
        del: jest.fn(async (k: string) => Number(store.delete(k))),
        eval: jest.fn(
            async (_script: string, _n: number, list: string, dropped: string, value: string, startedAt: string) => {
                if (Number(store.get(dropped) ?? 0) >= Number(startedAt)) return 0
                store.set(list, value)
                return 1
            },
        ),
    }
}

const make = () => {
    const redis = makeRedis()
    const prisma = { background: new BackgroundTasks(jest.fn()) }
    return { redis, prisma, cache: new CallListCacheService(prisma as never, redis as never) }
}

beforeEach(() => {
    ;(loadCallList as jest.Mock).mockReset().mockResolvedValue(LIST)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})

describe('CallListCacheService', () => {
    it('computes once per club and serves the copy until the TTL runs out', async () => {
        const { cache, redis, prisma } = make()
        expect(await cache.get('w1')).toEqual(LIST)
        expect(await cache.get('w1')).toEqual(LIST)
        expect(loadCallList).toHaveBeenCalledTimes(1)
        expect((loadCallList as jest.Mock).mock.calls[0][0]).toBe(prisma)
        expect((loadCallList as jest.Mock).mock.calls[0][1]).toMatchObject({ workspaceId: 'w1' })
        expect(redis.eval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])"),
            2,
            'call-list:w1',
            'call-list:w1:dropped',
            expect.any(String),
            expect.any(String),
            String(CALL_LIST_TTL_MS),
        )
        // Another club is its own entry.
        await cache.get('w2')
        expect(loadCallList).toHaveBeenCalledTimes(2)
    })

    it('recomputes over an entry older than the TTL', async () => {
        const { cache, redis } = make()
        redis.store.set(
            'call-list:w1',
            JSON.stringify({ at: Date.now() - CALL_LIST_TTL_MS - 1, list: LIST }),
        )
        ;(loadCallList as jest.Mock).mockResolvedValue(FRESH)
        expect(await cache.get('w1')).toEqual(FRESH)
    })

    it('recomputes right after a contact drops the list', async () => {
        const { cache } = make()
        await cache.get('w1')
        await cache.invalidate('w1')
        ;(loadCallList as jest.Mock).mockResolvedValue(FRESH)
        expect(await cache.get('w1')).toEqual(FRESH)
        expect(loadCallList).toHaveBeenCalledTimes(2)
    })

    it('does not store a computation that started before the drop', async () => {
        const { cache, redis } = make()
        let finish: (v: unknown) => void = () => undefined
        ;(loadCallList as jest.Mock).mockReturnValueOnce(
            new Promise((resolve) => {
                finish = resolve
            }),
        )
        const slow = cache.get('w1')
        // Let the read miss and the computation start.
        await new Promise((r) => setImmediate(r))
        await cache.invalidate('w1')
        finish(LIST)
        expect(await slow).toEqual(LIST)
        expect(redis.store.has('call-list:w1')).toBe(false)
    })

    it('falls back to the database when Redis is down', async () => {
        const { cache, redis } = make()
        redis.get.mockRejectedValue(new Error('down'))
        redis.set.mockRejectedValue(new Error('down'))
        redis.del.mockRejectedValue(new Error('down'))
        redis.eval.mockRejectedValue(new Error('down'))
        expect(await cache.get('w1')).toEqual(LIST)
        await expect(cache.invalidate('w1')).resolves.toBeUndefined()
    })

    it('stops waiting for a Redis that does not answer and reads the database', async () => {
        jest.useFakeTimers()
        try {
            const { cache, redis } = make()
            const silent = () => new Promise<never>(() => undefined)
            redis.get.mockImplementation(silent)
            redis.eval.mockImplementation(silent)
            const read = cache.get('w1')
            await jest.advanceTimersByTimeAsync(CACHE_WAIT_MS)
            await expect(read).resolves.toEqual(LIST)
        } finally {
            jest.useRealTimers()
        }
    })
})
