import { NotificationTypeEnum } from '../../../infrastructure/prisma'
import { NotificationsEventPattern } from '../configs/notifications-events.config'

export interface SendNotificationPayload {
    userId: string
    identity: string
    type: NotificationTypeEnum
    topic: string
    message: string
    link?: string
    metadata?: Record<string, any>
}

export interface UpdateNotificationStatusPayload {
    id: string
    sent: boolean
    sentPayload?: Record<string, any>
    error?: string
}

export const NotificationTypeToPattern: Record<
    NotificationTypeEnum,
    NotificationsEventPattern
> = {
    [NotificationTypeEnum.EMAIL]: NotificationsEventPattern.NOTIFICATION_EMAIL,
    [NotificationTypeEnum.PUSH]:
        NotificationsEventPattern.NOTIFICATION_FIREBASE,
    [NotificationTypeEnum.TELEGRAM]:
        NotificationsEventPattern.NOTIFICATION_TELEGRAM,
}
