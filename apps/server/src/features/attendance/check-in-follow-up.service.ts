import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'

import { captureException } from '../../app/sentry'
import { ClassPackNotifierService } from '../../domains/subscriptions/services/class-pack-notifier.service'
import { AchievementNotifierService } from '../get-my-achievements/achievement-notifier.service'

export type CheckInFollowUp = {
    workspaceId: string
    // Members a write just counted as present.
    userIds: string[]
    // Class packs that write drew a class from.
    subscriptionIds: string[]
}

/**
 * Pushes that follow a committed check-in (low / used-up class pack,
 * newly unlocked achievements). They used to run inside the request — one
 * full-history query per marked member — so a coach marking 40 people waited
 * on 160+ queries. Now the request returns once attendance is committed and
 * these run right after; a failure is logged and reported, never surfaced to
 * the coach or member, whose check-in already stands.
 */
@Injectable()
export class CheckInFollowUpService implements OnModuleDestroy {
    private readonly logger = new Logger(CheckInFollowUpService.name)
    private readonly inFlight = new Set<Promise<void>>()

    constructor(
        private readonly classPacks: ClassPackNotifierService,
        private readonly achievements: AchievementNotifierService,
    ) {}

    /** Fire-and-forget; the caller must already have committed. */
    schedule(job: CheckInFollowUp): void {
        if (job.userIds.length === 0 && job.subscriptionIds.length === 0) {
            return
        }
        const task = this.run(job).finally(() => this.inFlight.delete(task))
        this.inFlight.add(task)
    }

    /** Resolves once every scheduled follow-up has settled. */
    async drain(): Promise<void> {
        await Promise.all([...this.inFlight])
    }

    // Let pending pushes finish before Prisma disconnects on shutdown.
    async onModuleDestroy(): Promise<void> {
        await this.drain()
    }

    private async run(job: CheckInFollowUp): Promise<void> {
        await this.attempt('class-pack alert', () =>
            this.classPacks.notifyLowOrExhausted(
                job.subscriptionIds,
                job.workspaceId,
            ),
        )
        await this.attempt('achievement check', () =>
            this.achievements.notifyUnlocked(job.userIds, job.workspaceId),
        )
    }

    private async attempt(
        what: string,
        fn: () => Promise<void>,
    ): Promise<void> {
        try {
            await fn()
        } catch (err) {
            this.logger.error(
                `${what} failed after check-in: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
            captureException(err)
        }
    }
}
