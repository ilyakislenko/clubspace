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

export interface SendWebPayload {
    userId: string
    topic: string
    message: string
    link?: string
}

export interface LinkTelegramAccountPayload {
    chatId: number
    userId: string
}

export interface UnlinkTelegramAccountPayload {
    userId: string
}

export interface ChangePreferences {
    userId: string
    emailEnabled?: boolean
    email?: string | null
    pushEnabled?: boolean
    telegramEnabled?: boolean
    telegramAccount?: number | null
}

export interface GetNotificationsPayload {
    userId?: string
    cursor?: string
    take?: number
    type: NotificationTypeEnum
    seen?: boolean
}

export interface MarkAsReadPayload {
    userId: string
    notificationId: string
}

export interface MarkAllAsReadPayload {
    type: NotificationTypeEnum
    userId: string
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
