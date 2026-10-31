import { MailerService } from '@nestjs-modules/mailer'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job, UnrecoverableError } from 'bullmq'

import {
    EMAIL_QUEUE,
    type EmailJobData,
} from '../../domains/notifications/email-queue'
import {
    isTransportError,
    MailHealthService,
} from '../../domains/notifications/services/mail-health.service'
import { NotificationsService } from '../../domains/notifications/services/notifications.service'
import { PrismaService } from '../../infrastructure/prisma'

// Delivers the `email` queue. A home server's mail relay blips (Wi-Fi drop,
// relay restart) far more often than it dies: a transport failure is thrown
// back to BullMQ, which retries with backoff (EMAIL_JOB_OPTS). A rejected
// recipient is permanent and fails the job at once.
@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class SendEmailNotificationProcessor extends WorkerHost {
    private readonly logger = new Logger(SendEmailNotificationProcessor.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly mailer: MailerService,
        private readonly notifications: NotificationsService,
        private readonly mailHealth: MailHealthService,
    ) {
        super()
    }

    async process(job: Job<EmailJobData>): Promise<void> {
        const { notificationId, to } = job.data
        const row = await this.prisma.notification.findUnique({
            where: { id: notificationId },
            select: { topic: true, message: true, sent: true },
        })
        // Gone (the user was deleted) or already delivered by an earlier
        // attempt that crashed before the job was acknowledged.
        if (!row || row.sent) return

        let result: { messageId?: string } | undefined
        try {
            result = await this.mailer.sendMail({
                to,
                subject: row.topic,
                html: `<!DOCTYPE html>
                    <html>
                    <head>
                      <meta charset="utf-8" />
                      <meta name="viewport" content="width=device-width" />
                      <title>${row.topic}</title>
                    </head>
                    <body>
                        ${row.message}
                    </body>`,
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const transient = isTransportError(error)
            const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
            if (!transient || lastAttempt) {
                this.mailHealth.recordFailure(error)
                this.logger.error(`e-mail ${notificationId} failed: ${message}`)
                await this.notifications.updateNotificationStatus({
                    id: notificationId,
                    sent: false,
                    error: message,
                })
            } else {
                this.logger.warn(
                    `mail transport error, attempt ${job.attemptsMade + 1}: ${message}`,
                )
            }
            if (!transient) throw new UnrecoverableError(message)
            throw error
        }

        this.mailHealth.recordDelivered()
        await this.notifications.updateNotificationStatus({
            id: notificationId,
            sent: true,
            sentPayload: result?.messageId ? { messageId: result.messageId } : undefined,
        })
    }
}
