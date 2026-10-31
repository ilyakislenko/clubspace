import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Queue } from 'bullmq'

import { withTimeout } from '../../../shared/utils/with-timeout'
import {
    PUSH_IDS_PER_JOB,
    PUSH_JOB,
    PUSH_QUEUE,
    PUSH_RECEIPTS_JOB_OPTS,
    PUSH_SEND_JOB_OPTS,
    type PushReceiptsJobData,
    type PushSendJobData,
} from '../push-queue'

// ioredis queues commands while reconnecting instead of failing them; a request
// that created a notification must not hang on that.
const ENQUEUE_TIMEOUT_MS = 2_000

// Producer side of the push queue. Every code path that writes a PUSH
// notification row hands the new ids here.
@Injectable()
export class PushQueueService {
    private readonly logger = new Logger(PushQueueService.name)

    constructor(@InjectQueue(PUSH_QUEUE) private readonly queue: Queue) {}

    /**
     * Never throws: the notification rows are already committed (they are the
     * inbox entries), so a Redis hiccup must not fail the caller. The sweep job
     * re-enqueues anything still pending a couple of minutes later.
     */
    async enqueue(ids: string[]): Promise<void> {
        if (ids.length === 0) return
        const jobs: {
            name: string
            data: PushSendJobData
            opts: typeof PUSH_SEND_JOB_OPTS
        }[] = []
        for (let i = 0; i < ids.length; i += PUSH_IDS_PER_JOB) {
            jobs.push({
                name: PUSH_JOB.send,
                data: { ids: ids.slice(i, i + PUSH_IDS_PER_JOB) },
                opts: PUSH_SEND_JOB_OPTS,
            })
        }
        try {
            await withTimeout(this.queue.addBulk(jobs), ENQUEUE_TIMEOUT_MS)
        } catch (err) {
            this.logger.warn(
                `Could not enqueue ${ids.length} push notification(s), the sweep will retry: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }

    async enqueueReceipts(
        tickets: PushReceiptsJobData['tickets'],
    ): Promise<void> {
        if (tickets.length === 0) return
        await this.queue.add(
            PUSH_JOB.receipts,
            { tickets } satisfies PushReceiptsJobData,
            PUSH_RECEIPTS_JOB_OPTS,
        )
    }
}
