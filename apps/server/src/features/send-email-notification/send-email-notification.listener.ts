import { MailerService } from '@nestjs-modules/mailer'
import { Inject, Injectable, Logger } from '@nestjs/common'

import {
    NOTIFICATIONS_LISTENER,
    NotificationsEventPattern,
    type NotificationsEventsListener,
} from '../../domains/notifications/configs/notifications-events.config'
import { NotificationsService } from '../../domains/notifications/services/notifications.service'

@Injectable()
export class SendEmailNotificationListener {
    private readonly logger = new Logger(SendEmailNotificationListener.name)

    constructor(
        @Inject(NOTIFICATIONS_LISTENER)
        private readonly notificationsEvents: NotificationsEventsListener,
        private readonly mailer: MailerService,
        private readonly notifications: NotificationsService,
    ) {}

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
                    const result = await this.mailer.sendMail({
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
