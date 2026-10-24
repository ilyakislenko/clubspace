import { MailerService } from '@nestjs-modules/mailer'
import { Inject, Injectable, Logger } from '@nestjs/common'

import {
    NOTIFICATIONS_LISTENER,
    NotificationsEventPattern,
    type NotificationsEventsListener,
} from '../../domains/notifications/configs/notifications-events.config'
import {
    isTransportError,
    MailHealthService,
} from '../../domains/notifications/services/mail-health.service'
import { NotificationsService } from '../../domains/notifications/services/notifications.service'

// A home server's mail relay blips (Wi-Fi drop, relay restart) far more often
// than it dies. Retrying transport failures rides those out; a rejected
// recipient is permanent and is not retried.
export const EMAIL_RETRY_DELAYS_MS = [5_000, 30_000]

@Injectable()
export class SendEmailNotificationListener {
    private readonly logger = new Logger(SendEmailNotificationListener.name)

    constructor(
        @Inject(NOTIFICATIONS_LISTENER)
        private readonly notificationsEvents: NotificationsEventsListener,
        private readonly mailer: MailerService,
        private readonly notifications: NotificationsService,
        private readonly mailHealth: MailHealthService,
    ) {}

    // Separate so specs can skip the real backoff.
    protected sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async sendWithRetry(
        mail: Parameters<MailerService['sendMail']>[0],
    ) {
        for (let attempt = 0; ; attempt++) {
            try {
                const result = await this.mailer.sendMail(mail)
                this.mailHealth.recordDelivered()
                return result
            } catch (error) {
                const retryIn = EMAIL_RETRY_DELAYS_MS[attempt]
                if (!isTransportError(error) || retryIn === undefined) {
                    this.mailHealth.recordFailure(error)
                    throw error
                }
                this.logger.warn(
                    `mail transport error, retry ${attempt + 1} in ${retryIn}ms: ${(error as Error).message}`,
                )
                await this.sleep(retryIn)
            }
        }
    }

    async onApplicationBootstrap() {
        try {
            this.listenNotificationEmail()
        } catch (error: any) {
            this.logger.error(error, error.stack)
        }
    }

    listenNotificationEmail() {
        this.notificationsEvents.listen(
            NotificationsEventPattern.NOTIFICATION_EMAIL,
            async (event) => {
                const {
                    data: { notificationId, topic, message, identity },
                } = event

                try {
                    const result = await this.sendWithRetry({
                        to: identity,
                        subject: topic,
                        html: `<!DOCTYPE html>
                    <html>
                    <head>
                      <meta charset="utf-8" />
                      <meta name="viewport" content="width=device-width" />
                      <title>${topic}</title>
                    </head>
                    <body>
                        ${message}
                    </body>`,
                    })

                    await this.notifications.updateNotificationStatus({
                        id: notificationId,
                        sentPayload: result,
                        sent: true,
                    })
                } catch (error: any) {
                    this.logger.error(error.message)

                    // Nothing is awaiting this listener — it runs from an
                    // event after the originating request has already
                    // answered. An exception escaping here is an unhandled
                    // rejection, which Node treats as fatal, so a failed
                    // bookkeeping write would take the process down over an
                    // email that had already failed anyway.
                    try {
                        await this.notifications.updateNotificationStatus({
                            id: notificationId,
                            sent: false,
                            error: error.message,
                        })
                    } catch (statusError: any) {
                        this.logger.error(
                            `Failed to record delivery failure for notification ${notificationId}: ${statusError?.message}`,
                        )
                    }
                }
            },
        )
    }
}
