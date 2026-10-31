import { NotificationTypeEnum } from '../../../infrastructure/prisma'

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
