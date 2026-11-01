import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants'
import { LeaderboardPeriod } from './get-attendance-leaderboard.feature'

// The workspace-wide part of a leaderboard: identical for every member who
// opens it, so one computation serves the whole club for the TTL.
export type LeaderboardBoard = {
    // Visible ACTIVE members with at least one check-in, ranked.
    ranked: Array<{
        userId: string
        name: string
        checkins: number
        rank: number
    }>
    // Check-ins in the period for every user who has any (hidden members and
    // the owner included), so the caller's own line needs no extra query.
    counts: Record<string, number>
    // ACTIVE members who opted out of the board.
    hiddenUserIds: string[]
}

// Short on purpose: attendance writes invalidate explicitly; the TTL only
// bounds staleness from writes that don't (renames, roster changes).
const TTL_MS = 60_000

// One Redis hash per club holds every (period, direction) board, so
// `invalidate` drops them all with a single DEL without knowing the club's
// directions. Hash fields can't expire on their own: each entry carries its
// write time and is ignored once older than the TTL; the hash itself expires
// TTL after the last write.
const key = (workspaceId: string): string => `leaderboard:${workspaceId}`

const field = (period: LeaderboardPeriod, directionId: string | null): string =>
    `${period}:${directionId ?? 'all'}`

type Entry = { at: number; board: LeaderboardBoard }

@Injectable()
export class LeaderboardCacheService {
    private readonly logger = new Logger(LeaderboardCacheService.name)

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    /**
     * Cached board for (period, direction — null = whole club), or `compute()`
     * stored for the TTL. A Redis failure only costs the cache — the board is
     * computed from the database as before.
     */
    async getOrCompute(
        workspaceId: string,
        period: LeaderboardPeriod,
        directionId: string | null,
        compute: () => Promise<LeaderboardBoard>,
    ): Promise<LeaderboardBoard> {
        const k = key(workspaceId)
        const f = field(period, directionId)
        try {
            const hit = await this.redis.hget(k, f)
            if (hit) {
                const entry = JSON.parse(hit) as Entry
                if (Date.now() - entry.at < TTL_MS) return entry.board
            }
        } catch (err) {
            this.warn('read', err)
        }
        const board = await compute()
        try {
            const entry: Entry = { at: Date.now(), board }
            await this.redis.hset(k, f, JSON.stringify(entry))
            await this.redis.pexpire(k, TTL_MS)
        } catch (err) {
            this.warn('write', err)
        }
        return board
    }

    /**
     * Drop every period's and every direction's board for the club after an
     * attendance write.
     */
    async invalidate(workspaceId: string): Promise<void> {
        try {
            await this.redis.del(key(workspaceId))
        } catch (err) {
            this.warn('invalidate', err)
        }
    }

    private warn(op: string, err: unknown): void {
        this.logger.warn(
            `leaderboard cache ${op} failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        )
    }
}
