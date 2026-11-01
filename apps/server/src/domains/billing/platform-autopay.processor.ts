import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { PlatformAutopayService } from './services/platform-autopay.service'
import { TrialRemindersService } from './services/trial-reminders.service'

// Same shape as BILLING_LIFECYCLE_QUEUE: its own queue, one job scheduler
// upserted by id, global concurrency 1 across replicas.
export const PLATFORM_AUTOPAY_QUEUE = 'scheduler-billing-autopay'

// Hourly: a renewal is charged up to a day before the period ends, and a
// retry falls due at its own hour. The trial reminders (day 23/28) ride the
// same pass, so one reaches the owner within the hour it falls due.
@Processor(PLATFORM_AUTOPAY_QUEUE)
export class PlatformAutopayProcessor extends WorkerHost implements OnModuleInit {
    private readonly logger = new Logger(PlatformAutopayProcessor.name)

    constructor(
        private readonly autopay: PlatformAutopayService,
        private readonly reminders: TrialRemindersService,
        @InjectQueue(PLATFORM_AUTOPAY_QUEUE) private readonly queue: Queue,
    ) {
        super()
    }

    async onModuleInit(): Promise<void> {
        await this.queue.setGlobalConcurrency(1)
        await this.queue.upsertJobScheduler(
            this.queue.name,
            { pattern: '20 * * * *', tz: 'UTC' },
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
        const counts = await this.autopay.runRenewals()
        if (Object.keys(counts).length > 0) {
            this.logger.log(`${this.queue.name} #${job.id}: ${JSON.stringify(counts)}`)
        }
        const reminded = await this.reminders.run()
        if (reminded > 0) {
            this.logger.log(`${this.queue.name} #${job.id}: ${reminded} trial reminders`)
        }
    }
}
