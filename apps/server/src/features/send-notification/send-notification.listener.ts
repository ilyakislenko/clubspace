import { Inject, Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import {
    USERS_LISTENER,
    UsersEventPattern,
} from '../../domains/users/configs/users-events.config'
import type { UsersEventsListener } from '../../domains/users/configs/users-events.config'
import { EmailTemplatesService } from '../../domains/email-templates/services/email-templates.service'
import { NotificationsService } from '../../domains/notifications/services/notifications.service'
import { NotificationTypeEnum } from '../../infrastructure/prisma'
import { SendNotificationFeature } from './send-notification.feature'
import type { SendNotificationFeatureResponse } from './send-notification.feature'

@Injectable()
export class SendNotificationListener {
    private readonly logger = new Logger(SendNotificationListener.name)

    constructor(
        @Inject(USERS_LISTENER)
        private readonly usersEvents: UsersEventsListener,
        private readonly featuresBus: FeaturesBus,
        private readonly emailTemplates: EmailTemplatesService,
        private readonly notifications: NotificationsService,
    ) {}

    async onApplicationBootstrap() {
        try {
            this.listenUserCompleteCodeCreated()
            this.listenPendingSignInCodeCreated()
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error(error.message, error.stack)
            } else {
                this.logger.error(String(error))
            }
        }
    }

    private listenUserCompleteCodeCreated() {
        this.usersEvents.listen(
            UsersEventPattern.USER_COMPLETE_CODE_CREATED,
            async ({ data }) => {
                const { userId, completeCode } = data as {
                    userId: string
                    completeCode: string
                }

                try {
                    await this.featuresBus.execute<
                        SendNotificationFeature,
                        SendNotificationFeatureResponse
                    >(
                        new SendNotificationFeature({
                            userId,
                            topic: `Код для входа: ${completeCode}`,
                            message: {
                                htmlTemplateKey: 'code',
                                data: {
                                    code: completeCode,
                                },
                            },
                            types: [NotificationTypeEnum.EMAIL],
                            forced: true,
                        }),
                    )
                } catch (error) {
                    if (error instanceof Error) {
                        this.logger.error(error.message, error.stack)
                    } else {
                        this.logger.error(String(error))
                    }
                }
            },
        )
    }

    // No account yet, so no inbox row or preferences: straight to the address.
    private listenPendingSignInCodeCreated() {
        this.usersEvents.listen(
            UsersEventPattern.PENDING_SIGN_IN_CODE_CREATED,
            async ({ data }) => {
                const { email, completeCode } = data as {
                    email: string
                    completeCode: string
                }
                try {
                    const template = await this.emailTemplates.getTemplate({
                        key: 'code',
                        data: { code: completeCode },
                    })
                    await this.notifications.sendEmailToAddress({
                        to: email,
                        subject: `Код для входа: ${completeCode}`,
                        html: template.content,
                    })
                } catch (error) {
                    if (error instanceof Error) {
                        this.logger.error(error.message, error.stack)
                    } else {
                        this.logger.error(String(error))
                    }
                }
            },
        )
    }
}
