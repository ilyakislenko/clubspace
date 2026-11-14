import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { AnalyticsSnapshotService } from '../../domains/analytics/analytics-snapshot.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'

export const ANALYTICS_REFRESH_QUEUE = 'analytics-refresh'

// The realtime resource the admin's «Аналитика» pages reload on.
export const ANALYTICS_REALTIME_RESOURCE = 'analytics'

// «Пересчитать» is skipped while both snapshots are younger than this.
export const ANALYTICS_FRESH_MS = 5 * 60_000

export type AnalyticsRefreshJob = { workspaceId: string }

// One job id per club: while a recompute waits or runs, adding another is a
// no-op in BullMQ, so two clicks (or two admins) start one rebuild. Finished
// and failed jobs are removed at once, which frees the id for the next one.
export const queueAnalyticsRefresh = async (queue: Queue, workspaceId: string): Promise<void> => {
    await queue.add('refresh', { workspaceId } satisfies AnalyticsRefreshJob, {
        jobId: `refresh-${workspaceId}`,
        removeOnComplete: true,
        removeOnFail: true,
    })
}

// Rebuilds one club's snapshots outside the request (a whole-club recompute
// takes seconds), then tells the club's open pages to reload — also after a
// failure, so a waiting «Пересчитываем…» ends; the page then sees the old
// computedAt.
@Processor(ANALYTICS_REFRESH_QUEUE, { concurrency: 2 })
export class AnalyticsRefreshProcessor extends WorkerHost {
    private readonly logger = new Logger(AnalyticsRefreshProcessor.name)

    constructor(
        private readonly snapshots: AnalyticsSnapshotService,
        private readonly realtime: RealtimeEmitter,
    ) {
        super()
    }

    async process(job: Job<AnalyticsRefreshJob>): Promise<void> {
        const { workspaceId } = job.data
        const started = Date.now()
        try {
            await this.snapshots.refresh(workspaceId)
            this.logger.log(`analytics refresh of ${workspaceId} in ${Date.now() - started}ms`)
        } catch (error) {
            this.logger.error(`analytics refresh of ${workspaceId} failed`, error as Error)
        } finally {
            this.realtime.invalidate(workspaceId, [ANALYTICS_REALTIME_RESOURCE])
        }
    }
}
