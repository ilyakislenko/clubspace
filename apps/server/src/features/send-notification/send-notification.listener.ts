import { Inject, Injectable, Logger } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import {
    USERS_LISTENER,
    UsersEventPattern,
} from '../../domains/users/configs/users-events.config'
import type { UsersEventsListener } from '../../domains/users/configs/users-events.config'
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
    ) {}

    async onApplicationBootstrap() {
        try {
            this.listenUserCompleteCodeCreated()
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
                            topic: 'Verification code',
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
}
