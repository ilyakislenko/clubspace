import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Queue } from 'bullmq'

import { PrismaService } from '../../infrastructure/prisma'
import { withTimeout } from '../../shared/utils/with-timeout'
import { TelegramBotClient } from './telegram-bot.client'
import {
    TELEGRAM_JOB_SEND,
    TELEGRAM_QUEUE,
    TELEGRAM_SEND_JOB_OPTS,
    type TelegramSendJobData,
    telegramJobId,
} from './telegram-queue'

// ioredis queues commands while reconnecting; a delivery job must not hang on it.
const ENQUEUE_TIMEOUT_MS = 2_000

// Producer side of the telegram queue.
@Injectable()
export class TelegramQueueService {
    private readonly logger = new Logger(TelegramQueueService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly bot: TelegramBotClient,
        @InjectQueue(TELEGRAM_QUEUE) private readonly queue: Queue,
    ) {}

    /**
     * Mirrors notification rows that push delivery just claimed: only the
     * rows of users with a linked chat and Telegram switched on are queued
     * (one query for the batch). Never throws — push delivery must go on.
     */
    async enqueueForLinkedUsers(rows: { id: string; userId: string }[]): Promise<void> {
        if (rows.length === 0 || !this.bot.available) return
        try {
            const linked = await this.prisma.telegramLink.findMany({
                where: {
                    userId: { in: [...new Set(rows.map((r) => r.userId))] },
                    user: { notificationPreferences: { is: { telegramEnabled: true } } },
                },
                select: { userId: true },
            })
            if (linked.length === 0) return
            const users = new Set(linked.map((l) => l.userId))
            await this.enqueue(rows.filter((r) => users.has(r.userId)).map((r) => r.id))
        } catch (err) {
            this.logger.warn(
                `Could not queue Telegram copies: ${err instanceof Error ? err.message : String(err)}`,
            )
        }
    }

    /** Never throws: the rows are committed; a lost Telegram copy is logged. */
    async enqueue(ids: string[]): Promise<void> {
        if (ids.length === 0 || !this.bot.available) return
        try {
            await withTimeout(
                this.queue.addBulk(
                    ids.map((notificationId) => ({
                        name: TELEGRAM_JOB_SEND,
                        data: { notificationId } satisfies TelegramSendJobData,
                        opts: { ...TELEGRAM_SEND_JOB_OPTS, jobId: telegramJobId(notificationId) },
                    })),
                ),
                ENQUEUE_TIMEOUT_MS,
            )
        } catch (err) {
            this.logger.warn(
                `Could not enqueue ${ids.length} Telegram message(s): ${
                    err instanceof Error ? err.message : String(err)
                }`,
            )
        }
    }
}
