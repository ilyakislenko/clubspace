import { Inject, Injectable, Logger } from '@nestjs/common'
import type Redis from 'ioredis'

import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants'
import type { OrgClubMetrics } from './club-metrics'

// The per-club numbers of one org (club-metrics.ts), cached for 10 minutes:
// the cohort report per club is the heaviest read of the console
// (docs/design/2026-11-26-federation-hub-mvp.md §3.1, §13 «Metric cost»).
// Link and sharing changes (accept, leave, remove, sharing toggles) invalidate
// at once, so a club that leaves or turns money off disappears from the
// console on the next read — only the counts themselves may lag the TTL.
const TTL_MS = 10 * 60_000

const key = (organizationId: string): string => `org-metrics:${organizationId}`

export type OrgMetricsSnapshot = {
    computedAt: string
    clubs: OrgClubMetrics[]
}

@Injectable()
export class OrgMetricsCacheService {
    private readonly logger = new Logger(OrgMetricsCacheService.name)

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    // A Redis failure only costs the cache: the numbers are computed from the
    // database as without it.
    async getOrCompute(
        organizationId: string,
        compute: () => Promise<OrgClubMetrics[]>,
    ): Promise<OrgMetricsSnapshot> {
        const k = key(organizationId)
        try {
            const hit = await this.redis.get(k)
            if (hit) return JSON.parse(hit) as OrgMetricsSnapshot
        } catch (err) {
            this.warn('read', err)
        }
        const snapshot: OrgMetricsSnapshot = {
            computedAt: new Date().toISOString(),
            clubs: await compute(),
        }
        try {
            await this.redis.set(k, JSON.stringify(snapshot), 'PX', TTL_MS)
        } catch (err) {
            this.warn('write', err)
        }
        return snapshot
    }

    async invalidate(organizationId: string): Promise<void> {
        try {
            await this.redis.del(key(organizationId))
        } catch (err) {
            this.warn('invalidate', err)
        }
    }

    private warn(op: string, err: unknown): void {
        this.logger.warn(
            `org metrics cache ${op} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
    }
}
