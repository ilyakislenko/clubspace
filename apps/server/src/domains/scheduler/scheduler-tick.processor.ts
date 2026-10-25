import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnModuleInit } from '@nestjs/common'
import { Job, Queue } from 'bullmq'

import { PushDeliveryService } from '../notifications/services/push-delivery.service'
import { FirstVisitPendingService } from '../subscriptions/services/first-visit-pending.service'
import { PaymentReminderService } from '../subscriptions/services/payment-reminder.service'
import { SchedulerTickService } from './scheduler-tick.service'

export const SCHEDULER_TICK_QUEUE = 'schedule-tick'
const REPEATABLE_JOB_NAME = 'tick'

// Single repeatable BullMQ job that fires every minute and fans out
// every kind of schedule notification. Using BullMQ instead of a node
// `setInterval` gives us:
//   - distributed locking so multi-instance deploys don't double-fire
//   - persistent retries with exponential backoff if a tick fails
//   - dashboards via @bull-board if we ever wire it up
@Processor(SCHEDULER_TICK_QUEUE)
export class SchedulerTickProcessor
    extends WorkerHost
    implements OnModuleInit
{
    private readonly logger = new Logger(SchedulerTickProcessor.name)

    constructor(
        private readonly service: SchedulerTickService,
        private readonly pushDelivery: PushDeliveryService,
        private readonly firstVisitPending: FirstVisitPendingService,
        private readonly paymentReminders: PaymentReminderService,
        @InjectQueue(SCHEDULER_TICK_QUEUE) private readonly queue: Queue,
    ) {
        super()
    }

    async onModuleInit(): Promise<void> {
        // Idempotent register: BullMQ dedups by jobId/repeatJobKey, so
        // re-deploys just update the schedule without piling up extra
        // tickers. removeRepeatable cleans up legacy keys if we ever
        // change the repeat opts.
        await this.queue.add(
            REPEATABLE_JOB_NAME,
            {},
            {
                repeat: { every: 60_000 },
                jobId: 'schedule-tick-singleton',
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 },
            },
        )
        this.logger.log('schedule-tick repeatable job registered (every 60s)')
    }

    async process(job: Job): Promise<void> {
        const started = Date.now()
        let tickError: unknown
        try {
            const summary = await this.service.runTick()
            this.logger.log(
                `tick #${job.id} finished in ${Date.now() - started}ms — ${
                    summary.sessionsNotified
                }s/${summary.eventsNotified}e/${summary.cancellationsNotified}c/${summary.accessExpiryNotified}x`,
            )
        } catch (err) {
            tickError = err
            this.logger.error(
                `tick #${job.id} failed`,
                err instanceof Error ? err.stack : String(err),
            )
        }

        // First-visit abonements: auto-start after the deadline + reminders.
        // Own guard so it never masks (or is masked by) the tick fan-out.
        try {
            const res = await this.firstVisitPending.run()
            if (res.autoStarted > 0 || res.reminded > 0) {
                this.logger.log(
                    `tick #${job.id} first-visit: ${res.autoStarted} auto-started, ${res.reminded} reminded`,
                )
            }
        } catch (err) {
            this.logger.error(
                `tick #${job.id} first-visit pass failed`,
                err instanceof Error ? err.stack : String(err),
            )
        }

        // Running abonements nobody has marked as paid: remind the member.
        try {
            const reminded = await this.paymentReminders.dispatchDue()
            if (reminded > 0) {
                this.logger.log(
                    `tick #${job.id} payment reminders: ${reminded} sent`,
                )
            }
        } catch (err) {
            this.logger.error(
                `tick #${job.id} payment reminders failed`,
                err instanceof Error ? err.stack : String(err),
            )
        }

        // Flush pending pushes regardless of whether the fan-out above
        // succeeded — rows written by earlier ticks still need delivering.
        // Guarded separately so a delivery hiccup never masks a tick failure
        // (which BullMQ should still retry).
        try {
            const delivered = await this.pushDelivery.deliverPending()
            if (delivered > 0) {
                this.logger.log(`tick #${job.id} delivered ${delivered} push notification(s)`)
            }
        } catch (err) {
            this.logger.error(
                `tick #${job.id} push delivery failed`,
                err instanceof Error ? err.stack : String(err),
            )
        }

        if (tickError) throw tickError
    }
}
