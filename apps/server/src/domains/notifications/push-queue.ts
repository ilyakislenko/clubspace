import type { JobsOptions } from 'bullmq'

// BullMQ queue that delivers PUSH notification rows to Expo. A notification
// row is written first (it is the inbox entry either way); its id is then
// enqueued here. Workers batch up to 100 rows per job.
export const PUSH_QUEUE = 'push'

export const PUSH_JOB = {
    // data: { ids: string[] } — notification ids to deliver
    send: 'send',
    // data: { tickets: { id, token }[] } — Expo tickets to check receipts for
    receipts: 'receipts',
    // Repeatable recovery pass for rows whose enqueue was lost.
    sweep: 'sweep',
} as const

export const PUSH_IDS_PER_JOB = 100

export type PushSendJobData = { ids: string[] }
export type PushReceiptsJobData = { tickets: { id: string; token: string }[] }

const DAY_MS = 24 * 60 * 60 * 1000

// Six attempts at 10s·2^n ≈ 10 min of retries for an Expo outage; after that
// the sweep picks the rows up again while they're inside the age window.
export const PUSH_SEND_JOB_OPTS: JobsOptions = {
    attempts: 6,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * DAY_MS / 1000, count: 1000 },
}

// Expo recommends checking receipts ~15 minutes after sending.
export const PUSH_RECEIPTS_JOB_OPTS: JobsOptions = {
    delay: 15 * 60_000,
    attempts: 3,
    backoff: { type: 'fixed', delay: 15 * 60_000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * DAY_MS / 1000, count: 1000 },
}
