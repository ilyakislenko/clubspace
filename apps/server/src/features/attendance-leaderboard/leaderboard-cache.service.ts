import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants'
import {
    LeaderboardPeriod,
    LeaderboardPeriodSchema,
} from './get-attendance-leaderboard.feature'

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

const key = (workspaceId: string, period: LeaderboardPeriod): string =>
    `leaderboard:${workspaceId}:${period}`

@Injectable()
export class LeaderboardCacheService {
    private readonly logger = new Logger(LeaderboardCacheService.name)

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    /**
     * Cached board, or `compute()` stored for the TTL. A Redis failure only
     * costs the cache — the board is computed from the database as before.
     */
    async getOrCompute(
        workspaceId: string,
        period: LeaderboardPeriod,
        compute: () => Promise<LeaderboardBoard>,
    ): Promise<LeaderboardBoard> {
        const k = key(workspaceId, period)
        try {
            const hit = await this.redis.get(k)
            if (hit) return JSON.parse(hit) as LeaderboardBoard
        } catch (err) {
            this.warn('read', err)
        }
        const board = await compute()
        try {
            await this.redis.set(k, JSON.stringify(board), 'PX', TTL_MS)
        } catch (err) {
            this.warn('write', err)
        }
        return board
    }

    /** Drop every period's board for the club after an attendance write. */
    async invalidate(workspaceId: string): Promise<void> {
        try {
            await this.redis.del(
                ...LeaderboardPeriodSchema.options.map((p) =>
                    key(workspaceId, p),
                ),
            )
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
