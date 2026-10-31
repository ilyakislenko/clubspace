import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, OnModuleInit } from '@nestjs/common'
import type { Job, Queue, RepeatOptions } from 'bullmq'

import { RetentionDigestService } from '../retention/retention-digest.service'
import { FirstVisitPendingService } from '../subscriptions/services/first-visit-pending.service'
import { PaymentReminderService } from '../subscriptions/services/payment-reminder.service'
import { DailyClubService } from './daily-club.service'
import { DataPurgeService } from './data-purge.service'
import { RemindersService } from './reminders.service'

// One queue per background job, so each has its own schedule and a slow one
// can't hold up the others. Each queue runs with global concurrency 1: across
// every API replica at most one run of a job is active, so a run that outlasts
// its interval delays the next one instead of overlapping it. Every run is
// idempotent (NotificationDispatchLog claims), so a stalled job re-run after a
// crash is harmless.
export const SCHEDULER_QUEUES = {
    reminders: 'scheduler-reminders',
    dailyClub: 'scheduler-daily-club',
    payments: 'scheduler-payments',
    digest: 'scheduler-digest',
    purge: 'scheduler-purge',
} as const

const HALF_HOUR_MS = 30 * 60_000

abstract class SchedulerJobProcessor
    extends WorkerHost
    implements OnModuleInit
{
    protected abstract readonly logger: Logger

    protected constructor(
        private readonly queue: Queue,
        private readonly schedule: Omit<RepeatOptions, 'key'>,
    ) {
        super()
    }

    // The summary is logged; null means "nothing happened", logged at debug.
    protected abstract run(now: Date): Promise<string | null>

    async onModuleInit(): Promise<void> {
        await this.queue.setGlobalConcurrency(1)
        // Upsert by id: every replica registers the same single scheduler, and
        // a changed interval replaces the old one on deploy.
        await this.queue.upsertJobScheduler(this.queue.name, this.schedule, {
            name: this.queue.name,
            opts: {
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 200 },
            },
        })
    }

    async process(job: Job): Promise<void> {
        const started = Date.now()
        const summary = await this.run(new Date())
        const line = `${this.queue.name} #${job.id} in ${Date.now() - started}ms${
            summary ? ` — ${summary}` : ''
        }`
        if (summary) this.logger.log(line)
        else this.logger.debug(line)
    }
}

// Session/event reminders, cancellations, scheduled announcements: every minute.
@Processor(SCHEDULER_QUEUES.reminders)
export class RemindersProcessor extends SchedulerJobProcessor {
    protected readonly logger = new Logger(RemindersProcessor.name)

    constructor(
        private readonly reminders: RemindersService,
        @InjectQueue(SCHEDULER_QUEUES.reminders) queue: Queue,
    ) {
        super(queue, { every: 60_000 })
    }

    protected async run(now: Date): Promise<string | null> {
        const s = await this.reminders.run(now)
        const total =
            s.sessionsNotified +
            s.eventsNotified +
            s.cancellationsNotified +
            s.scheduledAnnouncementsPublished
        return total > 0
            ? `${s.sessionsNotified} classes, ${s.eventsNotified} events, ${s.cancellationsNotified} cancellations, ${s.scheduledAnnouncementsPublished} announcements`
            : null
    }
}

// Inactivity nudges + access expiry, once a day per club at local morning.
@Processor(SCHEDULER_QUEUES.dailyClub)
export class DailyClubProcessor extends SchedulerJobProcessor {
    protected readonly logger = new Logger(DailyClubProcessor.name)

    constructor(
        private readonly daily: DailyClubService,
        @InjectQueue(SCHEDULER_QUEUES.dailyClub) queue: Queue,
    ) {
        super(queue, { every: HALF_HOUR_MS })
    }

    protected async run(now: Date): Promise<string | null> {
        const s = await this.daily.run(now)
        if (s.failed > 0) {
            this.logger.error(`${s.failed} club(s) failed their daily pass`)
        }
        return s.clubs > 0
            ? `${s.clubs} clubs, ${s.inactivityNotified} inactivity, ${s.accessExpiryNotified} access expiry`
            : null
    }
}

// Abonement nudges inside club hours: unpaid reminders and the first-visit
// auto-start/reminders.
@Processor(SCHEDULER_QUEUES.payments)
export class PaymentsProcessor extends SchedulerJobProcessor {
    protected readonly logger = new Logger(PaymentsProcessor.name)

    constructor(
        private readonly paymentReminders: PaymentReminderService,
        private readonly firstVisitPending: FirstVisitPendingService,
        @InjectQueue(SCHEDULER_QUEUES.payments) queue: Queue,
    ) {
        super(queue, { every: HALF_HOUR_MS })
    }

    protected async run(now: Date): Promise<string | null> {
        const reminded = await this.paymentReminders.dispatchDue(now)
        const firstVisit = await this.firstVisitPending.run(now)
        return reminded + firstVisit.autoStarted + firstVisit.reminded > 0
            ? `${reminded} payment reminders, ${firstVisit.autoStarted} auto-started, ${firstVisit.reminded} first-visit reminders`
            : null
    }
}

// Monday «Кому позвонить» digest to coaches, at club-local 10:00.
@Processor(SCHEDULER_QUEUES.digest)
export class DigestProcessor extends SchedulerJobProcessor {
    protected readonly logger = new Logger(DigestProcessor.name)

    constructor(
        private readonly digest: RetentionDigestService,
        @InjectQueue(SCHEDULER_QUEUES.digest) queue: Queue,
    ) {
        super(queue, { every: HALF_HOUR_MS })
    }

    protected async run(now: Date): Promise<string | null> {
        const s = await this.digest.run(now)
        return s.workspaces > 0 ? `${s.workspaces} clubs, ${s.sent} sent` : null
    }
}

// Nightly retention purge, 03:30 UTC.
@Processor(SCHEDULER_QUEUES.purge)
export class PurgeProcessor extends SchedulerJobProcessor {
    protected readonly logger = new Logger(PurgeProcessor.name)

    constructor(
        private readonly purge: DataPurgeService,
        @InjectQueue(SCHEDULER_QUEUES.purge) queue: Queue,
    ) {
        super(queue, { pattern: '30 3 * * *', tz: 'UTC' })
    }

    protected async run(now: Date): Promise<string | null> {
        const s = await this.purge.run(now)
        return `${s.notifications} notifications, ${s.dispatchLog} dispatch-log rows, ${s.refreshTokens} refresh tokens deleted`
    }
}

export const SCHEDULER_PROCESSORS = [
    RemindersProcessor,
    DailyClubProcessor,
    PaymentsProcessor,
    DigestProcessor,
    PurgeProcessor,
]
