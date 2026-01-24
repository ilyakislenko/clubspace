import { FactoryProvider } from '@nestjs/common'
import {
    EventsListenerInterface,
    EventsPublisherInterface,
} from '@shelfjs/events'

export const NOTIFICATIONS_PUBLISHER = 'NOTIFICATIONS_PUBLISHER'
export const NOTIFICATIONS_LISTENER = 'NOTIFICATIONS_LISTENER'
export const NOTIFICATIONS_CONTEXT = 'notifications'

export type NotificationsEventPublisherProvider = Omit<
    FactoryProvider<NotificationsEventsPublisher>,
    'provide'
>

export type NotificationsEventsPublisher = EventsPublisherInterface<
    NotificationsEventPattern,
    NotificationsEventPatternToData
>

export type NotificationsEventsListener = EventsListenerInterface<
    NotificationsEventPattern,
    NotificationsEventPatternToData
>

export enum NotificationsEventPattern {
    NOTIFICATION_EMAIL = 'notification.email',
    NOTIFICATION_TELEGRAM = 'notification.telegram',
    NOTIFICATION_WEBSOCKET = 'notification.websocket',
    NOTIFICATION_FIREBASE = 'notification.firebase',
}

export interface SendNotificationEventPayload {
    notificationId: string
    identity: string
    topic: string
    message: string
    link?: string
    metadata?: Record<string, any>
}

type NotificationsEventPatternToData = {
    [NotificationsEventPattern.NOTIFICATION_EMAIL]: SendNotificationEventPayload
    [NotificationsEventPattern.NOTIFICATION_TELEGRAM]: SendNotificationEventPayload
    [NotificationsEventPattern.NOTIFICATION_WEBSOCKET]: SendNotificationEventPayload
    [NotificationsEventPattern.NOTIFICATION_FIREBASE]: SendNotificationEventPayload
}
