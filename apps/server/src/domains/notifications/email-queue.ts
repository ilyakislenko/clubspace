import type { JobsOptions } from 'bullmq'

// BullMQ queue for outgoing e-mail (sign-in codes included). The Notification
// row holds subject and body; the job only carries its id and the address, so
// a crash or an SMTP blip after the request answered no longer loses the mail.
export const EMAIL_QUEUE = 'email'
export const EMAIL_JOB_SEND = 'send'

export type EmailJobData = {
    notificationId: string
    to: string
}

// 5 attempts at 5s·2^n: a relay restart or Wi-Fi drop of up to ~1 min is
// ridden out. A rejected recipient fails at once (UnrecoverableError).
export const EMAIL_JOB_OPTS: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
}
