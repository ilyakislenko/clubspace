import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { BillingLifecycleService } from './services/billing-lifecycle.service'

// Same shape as the scheduler-* queues (domains/scheduler): its own queue, one
// job scheduler upserted by id, global concurrency 1 across replicas. Billing
// state changes once a day, so it does not share a queue with the per-minute
// or half-hourly passes.
export const BILLING_LIFECYCLE_QUEUE = 'scheduler-billing'

// Daily at 03:00 UTC: after midnight across Russia's time zones.
@Processor(BILLING_LIFECYCLE_QUEUE)
export class BillingLifecycleProcessor
    extends WorkerHost
    implements OnModuleInit
{
    private readonly logger = new Logger(BillingLifecycleProcessor.name)

    constructor(
        private readonly lifecycle: BillingLifecycleService,
        @InjectQueue(BILLING_LIFECYCLE_QUEUE) private readonly queue: Queue,
    ) {
        super()
    }

    async onModuleInit(): Promise<void> {
        await this.queue.setGlobalConcurrency(1)
        await this.queue.upsertJobScheduler(
            this.queue.name,
            { pattern: '0 3 * * *', tz: 'UTC' },
            {
                name: this.queue.name,
                opts: {
                    removeOnComplete: { count: 50 },
                    removeOnFail: { count: 200 },
                },
            },
        )
    }

    async process(job: Job): Promise<void> {
        const res = await this.lifecycle.run()
        this.logger.log(
            `${this.queue.name} #${job.id}: ${res.pastDue} past due, ${res.suspended} suspended`,
        )
    }
}
