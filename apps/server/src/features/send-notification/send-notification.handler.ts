import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { EmailTemplatesService } from '../../domains/email-templates/services/email-templates.service'
import {
    guardianTopic,
    loadGuardianRoutes,
} from '../../domains/notifications/guardian-routing'
import { NotificationsService } from '../../domains/notifications/services/notifications.service'
import { NotificationsPreferencesService } from '../../domains/notifications/services/preferences.service'
import { UsersService } from '../../domains/users/services/users.service'
import { NotificationTypeEnum, PrismaService } from '../../infrastructure/prisma'
import { SendNotificationFeature } from './send-notification.feature'
import type { SendNotificationFeatureResponse } from './send-notification.feature'

@Feature(SendNotificationFeature)
export class SendNotificationHandler
    implements
        IFeatureHandler<
            SendNotificationFeature,
            SendNotificationFeatureResponse
        >
{
    private readonly logger = new Logger(SendNotificationHandler.name)

    constructor(
        private readonly userService: UsersService,
        private readonly notificationPreferences: NotificationsPreferencesService,
        private readonly notifications: NotificationsService,
        private readonly emailTemplatesService: EmailTemplatesService,
        private readonly prisma: PrismaService,
    ) {}

    async execute({
        payload,
    }: SendNotificationFeature): Promise<SendNotificationFeatureResponse> {
        const { userId, topic, link, metadata } = payload
        try {
            let { types } = payload

            let message = ''

            if (typeof payload.message === 'object') {
                const { htmlTemplateKey, data } = payload.message

                const template = await this.emailTemplatesService.getTemplate({
                    key: htmlTemplateKey,
                    data,
                })

                message = template.content
            }

            if (typeof payload.message === 'string') {
                message = payload.message
            }

            if (!types.length) {
                types = [
                    NotificationTypeEnum.EMAIL,
                    NotificationTypeEnum.PUSH,
                    NotificationTypeEnum.TELEGRAM,
                ]
            }

            const user = await this.userService.getUserById({
                id: userId,
            })

            if (user.email === null) {
                // A dependent has no e-mail or devices: its guardians get the
                // notice instead, under their own preferences.
                const route = (
                    await loadGuardianRoutes(this.prisma, [userId])
                ).get(userId)
                if (!route) return { success: true }
                const results = await Promise.all(
                    route.guardianIds.map((guardianId) =>
                        this.execute(
                            new SendNotificationFeature({
                                ...payload,
                                userId: guardianId,
                                topic: guardianTopic(route, topic),
                                metadata: { ...metadata, dependentId: userId },
                            }),
                        ),
                    ),
                )
                return { success: results.every((r) => r.success) }
            }

            const preferences =
                await this.notificationPreferences.getPreferences({
                    userId,
                })

            const notificationTypesToSend: {
                type: NotificationTypeEnum
                identity: string
            }[] = []

            if (
                (payload.forced || preferences.emailEnabled) &&
                types.includes(NotificationTypeEnum.EMAIL)
            ) {
                notificationTypesToSend.push({
                    type: NotificationTypeEnum.EMAIL,
                    identity: user.email,
                })
            }

            if (
                (payload.forced || preferences.pushEnabled) &&
                types.includes(NotificationTypeEnum.PUSH)
            ) {
                notificationTypesToSend.push({
                    type: NotificationTypeEnum.PUSH,
                    identity: userId,
                })
            }

            if (!notificationTypesToSend.length) {
                return {
                    success: true,
                }
            }

            for (const notificationType of notificationTypesToSend) {
                const { identity, type } = notificationType

                if (!identity) {
                    continue
                }

                await this.notifications.sendNotification({
                    userId,
                    identity,
                    topic,
                    message,
                    type,
                    link,
                    metadata,
                })
            }

            return {
                success: true,
            }
        } catch (error) {
            this.logger.error(error)
            return {
                success: false,
            }
        }
    }
}
