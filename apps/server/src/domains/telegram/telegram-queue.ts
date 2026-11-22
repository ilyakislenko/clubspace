import type { JobsOptions } from 'bullmq'

// BullMQ queue that mirrors notification rows to the linked Telegram chat. One
// job per row (one sendMessage), so the worker's limiter is exactly the
// message rate and a failed send retries alone.
export const TELEGRAM_QUEUE = 'telegram'
export const TELEGRAM_JOB_SEND = 'send'

export type TelegramSendJobData = { notificationId: string }

const DAY_MS = 24 * 60 * 60 * 1000

// The job id is derived from the row, and finished jobs are kept for as long
// as a row can still be delivered (push MAX_AGE_MS), so a push retry or the
// push sweep claiming the same row again never sends it to Telegram twice.
export const telegramJobId = (notificationId: string): string =>
    `tg-${notificationId}`

// Six attempts at 10s·2^n ≈ 10 min of retries for a Telegram outage or a 429,
// like the push queue.
export const TELEGRAM_SEND_JOB_OPTS: JobsOptions = {
    attempts: 6,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: (3 * DAY_MS) / 1000 },
    removeOnFail: { age: (7 * DAY_MS) / 1000, count: 1000 },
}
