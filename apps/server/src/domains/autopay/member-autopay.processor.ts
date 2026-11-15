import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnModuleInit } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'

import { environment } from '../../environments/environment'
import { MemberAutopayService } from './member-autopay.service'

// Same shape as PLATFORM_AUTOPAY_QUEUE: one queue, one scheduler upserted by
// id, global concurrency 1 across replicas.
export const MEMBER_AUTOPAY_QUEUE = 'scheduler-member-autopay'

// Hourly at :40 (the platform pass is :20), so a due charge or reminder is
// picked within the hour of its club-local window. Does nothing while
// MEMBER_AUTOPAY_ENABLED is off.
@Processor(MEMBER_AUTOPAY_QUEUE)
export class MemberAutopayProcessor extends WorkerHost implements OnModuleInit {
    private readonly logger = new Logger(MemberAutopayProcessor.name)

    constructor(
        private readonly autopay: MemberAutopayService,
        @InjectQueue(MEMBER_AUTOPAY_QUEUE) private readonly queue: Queue,
    ) {
        super()
    }

    async onModuleInit(): Promise<void> {
        await this.queue.setGlobalConcurrency(1)
        await this.queue.upsertJobScheduler(
            this.queue.name,
            { pattern: '40 * * * *', tz: 'UTC' },
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
        if (!environment.memberAutopay.enabled) return
        const charges = await this.autopay.runCharges(new Date())
        if (Object.keys(charges).length > 0) {
            this.logger.log(`${this.queue.name} #${job.id}: ${JSON.stringify(charges)}`)
        }
        const reminded = await this.autopay.runReminders(new Date())
        if (reminded > 0) {
            this.logger.log(`${this.queue.name} #${job.id}: ${reminded} reminders`)
        }
    }
}
