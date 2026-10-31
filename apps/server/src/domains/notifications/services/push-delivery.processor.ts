import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnModuleInit } from '@nestjs/common'
import { Job, Queue } from 'bullmq'

import {
    PUSH_JOB,
    PUSH_QUEUE,
    type PushReceiptsJobData,
    type PushSendJobData,
} from '../push-queue'
import { PushDeliveryService } from './push-delivery.service'
import { PushQueueService } from './push-queue.service'

const SWEEP_SCHEDULER_ID = 'push-sweep'
const SWEEP_EVERY_MS = 5 * 60_000

// Push delivery workers. Each send job carries up to 100 notification ids, so
// concurrency 4 × limiter 4 jobs/s keeps one replica under Expo's
// 600 messages/s per-project ceiling while an evening reminder burst drains in
// seconds instead of queueing behind a 60s tick.
@Processor(PUSH_QUEUE, {
    concurrency: 4,
    limiter: { max: 4, duration: 1000 },
})
export class PushDeliveryProcessor extends WorkerHost implements OnModuleInit {
    private readonly logger = new Logger(PushDeliveryProcessor.name)

    constructor(
        private readonly delivery: PushDeliveryService,
        private readonly pushQueue: PushQueueService,
        @InjectQueue(PUSH_QUEUE) private readonly queue: Queue,
    ) {
        super()
    }

    async onModuleInit(): Promise<void> {
        // Upsert by id: every replica registers the same single scheduler.
        await this.queue.upsertJobScheduler(
            SWEEP_SCHEDULER_ID,
            { every: SWEEP_EVERY_MS },
            {
                name: PUSH_JOB.sweep,
                opts: { removeOnComplete: true, removeOnFail: { count: 100 } },
            },
        )
    }

    async process(job: Job): Promise<void> {
        switch (job.name) {
            case PUSH_JOB.send: {
                const { ids } = job.data as PushSendJobData
                const res = await this.delivery.deliver(ids)
                await this.pushQueue.enqueueReceipts(res.tickets)
                if (res.retry > 0) {
                    // Rows that did go out are already marked sent, so the
                    // retry only picks up the ones put back to pending.
                    throw new Error(
                        `${res.retry} push notification(s) failed transiently`,
                    )
                }
                return
            }
            case PUSH_JOB.receipts: {
                const { tickets } = job.data as PushReceiptsJobData
                const removed = await this.delivery.pruneFromReceipts(tickets)
                if (removed > 0) {
                    this.logger.log(`removed ${removed} unregistered device token(s)`)
                }
                return
            }
            case PUSH_JOB.sweep: {
                const ids = await this.delivery.findStalePending()
                if (ids.length > 0) {
                    this.logger.warn(`re-enqueueing ${ids.length} stale pending push notification(s)`)
                    await this.pushQueue.enqueue(ids)
                }
                return
            }
            default:
                this.logger.warn(`unknown push job "${job.name}" ignored`)
        }
    }
}
