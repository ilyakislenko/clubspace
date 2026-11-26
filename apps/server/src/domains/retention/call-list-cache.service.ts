import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'

import { PrismaService } from '../../infrastructure/prisma'
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants'
import { type CallList, loadCallList } from './call-list'

// The admin page, the dashboard tile and the apps poll about once a minute,
// and every one of them used to run the whole-club engine. One computation
// per club now serves them all for a minute; logging a contact drops it at
// once, so «Связались» takes the member off every surface on the next read.
// The TTL bounds staleness from writes that don't invalidate (check-ins,
// abonements, the hourly score snapshot).
export const CALL_LIST_TTL_MS = 60_000

const listKey = (workspaceId: string): string => `call-list:${workspaceId}`
// When the list was last invalidated: a computation that started earlier
// must not store its (pre-contact) result.
const droppedKey = (workspaceId: string): string => `call-list:${workspaceId}:dropped`

type Entry = { at: number; list: CallList }

// The shared client queues commands and retries while Redis is down, which
// would hold every call-list read for seconds. The cache gives up after this
// and the list is computed from the database.
export const CACHE_WAIT_MS = 500

// Executor form: the server's TS lib (es2022) has no Promise.withResolvers.
const withinCacheWait = <T>(op: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`no answer in ${CACHE_WAIT_MS} ms`)),
            CACHE_WAIT_MS,
        )
        op.then(resolve, reject).finally(() => clearTimeout(timer))
    })

// Store the list unless the club was dropped after the computation started —
// the check and the SET in one atomic step, so a contact logged in between
// cannot be overwritten by the older list.
// KEYS: list, dropped · ARGV: entry JSON, computation start (ms), TTL (ms).
const STORE_UNLESS_DROPPED = `
local dropped = tonumber(redis.call('GET', KEYS[2]) or '0')
if dropped >= tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1
`

@Injectable()
export class CallListCacheService {
    private readonly logger = new Logger(CallListCacheService.name)

    constructor(
        private readonly prisma: PrismaService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
    ) {}

    /**
     * The club's whole call list, cached for the TTL. A Redis failure only
     * costs the cache — the list is computed from the database as before.
     */
    async get(workspaceId: string): Promise<CallList> {
        const startedAt = Date.now()
        try {
            const hit = await withinCacheWait(this.redis.get(listKey(workspaceId)))
            if (hit) {
                const entry = JSON.parse(hit) as Entry
                if (startedAt - entry.at < CALL_LIST_TTL_MS) return entry.list
            }
        } catch (err) {
            this.warn('read', err)
        }
        const list = await loadCallList(this.prisma, {
            workspaceId,
            now: new Date(startedAt),
        })
        // Stored in the background (tracked, so shutdown waits for it): the
        // caller already has the list.
        const entry: Entry = { at: startedAt, list }
        this.prisma.background.run(() =>
            withinCacheWait(
                this.redis.eval(
                    STORE_UNLESS_DROPPED,
                    2,
                    listKey(workspaceId),
                    droppedKey(workspaceId),
                    JSON.stringify(entry),
                    String(startedAt),
                    String(CALL_LIST_TTL_MS),
                ),
            ).catch((err: unknown) => this.warn('write', err)),
        )
        return list
    }

    /** Drop the club's list after a write that changes who is on it. */
    async invalidate(workspaceId: string): Promise<void> {
        try {
            await withinCacheWait(
                this.redis.set(
                    droppedKey(workspaceId),
                    String(Date.now()),
                    'PX',
                    CALL_LIST_TTL_MS,
                ),
            )
            await withinCacheWait(this.redis.del(listKey(workspaceId)))
        } catch (err) {
            this.warn('invalidate', err)
        }
    }

    private warn(op: string, err: unknown): void {
        this.logger.warn(
            `call list cache ${op} failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        )
    }
}
