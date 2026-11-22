import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'

import { TelegramDeliveryService } from './telegram-delivery.service'
import { TELEGRAM_JOB_SEND, TELEGRAM_QUEUE, type TelegramSendJobData } from './telegram-queue'

// One message per job. Telegram allows about 30 messages a second per bot;
// BullMQ's limiter is shared by every replica through Redis, so 25/s leaves
// headroom for the webhook's replies.
@Processor(TELEGRAM_QUEUE, {
    concurrency: 5,
    limiter: { max: 25, duration: 1000 },
})
export class TelegramDeliveryProcessor extends WorkerHost {
    private readonly logger = new Logger(TelegramDeliveryProcessor.name)

    constructor(private readonly delivery: TelegramDeliveryService) {
        super()
    }

    async process(job: Job): Promise<void> {
        if (job.name !== TELEGRAM_JOB_SEND) {
            this.logger.warn(`unknown telegram job "${job.name}" ignored`)
            return
        }
        const { notificationId } = job.data as TelegramSendJobData
        // A transient failure throws: BullMQ retries with TELEGRAM_SEND_JOB_OPTS.
        const outcome = await this.delivery.deliver(notificationId)
        if (outcome === 'unlinked') {
            this.logger.log(`telegram chat unlinked after 403 (notification ${notificationId})`)
        }
    }
}
