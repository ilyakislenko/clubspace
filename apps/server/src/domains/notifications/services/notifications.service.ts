import { Inject, Injectable, Logger } from '@nestjs/common'

import {
    NotificationTypeEnum,
    Prisma,
    PrismaService,
} from '../../../infrastructure/prisma'
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import {
    NOTIFICATIONS_PUBLISHER,
    type NotificationsEventsPublisher,
} from '../configs/notifications-events.config'
import {
    NotificationTypeToPattern,
    SendNotificationPayload,
    UpdateNotificationStatusPayload,
} from '../interfaces/notifications.interfaces'

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name)

    constructor(
        private readonly prisma: PrismaService,
        @Inject(NOTIFICATIONS_PUBLISHER)
        private readonly events: NotificationsEventsPublisher,
    ) {}

    async sendNotification(payload: SendNotificationPayload): Promise<string> {
        const { userId, topic, type, message, link, identity, metadata } =
            payload

        const { id } = await this.prisma.notification.create({
            data: {
                type,
                sent: false,
                topic,
                message,
                link,
                seen: false,
                userId,
                metadata,
            },
        })

        // Fire-and-forget publish: the notification row is already persisted,
        // so a transient bus/transport failure must not fail the caller (or
        // surface as an unhandled rejection that silently drops delivery).
        void this.events
            .send({
                pattern: NotificationTypeToPattern[type],
                data: {
                    notificationId: id,
                    identity,
                    message,
                    topic,
                    link,
                    metadata,
                },
            })
            .catch((err: unknown) => {
                this.logger.warn(
                    `Failed to publish notification ${id}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            })

        return id
    }

    async updateNotificationStatus(
        dto: UpdateNotificationStatusPayload,
    ): Promise<void> {
        const { id, sent, error, sentPayload } = dto

        await this.prisma.notification.update({
            where: {
                id,
            },
            data: {
                sent,
                sentPayload,
                sentAt: sent ? new Date() : null,
                error,
            },
        })
    }

    async getNotifications(payload: {
        userId?: string
        types?: NotificationTypeEnum[]
        seen?: boolean
        curPage?: number
        perPage?: number
    }) {
        const { skip, take, curPage, perPage } = parseMetaArgs({
            curPage: payload.curPage,
            perPage: payload.perPage,
            defaults: {
                curPage: 1,
                perPage: 20,
            },
        })

        const queryOptions: {
            where: Prisma.NotificationWhereInput
            orderBy?: Prisma.NotificationOrderByWithRelationInput
        } = {
            where: {},
            orderBy: {
                createdAt: 'desc',
            },
        }

        if (payload.userId) {
            queryOptions.where.userId = payload.userId
        }

        if (payload.seen !== undefined) {
            queryOptions.where.seen = payload.seen
        }

        if (payload.types && payload.types?.length > 0) {
            queryOptions.where.type = {
                in: payload.types,
            }
        }

        const total = await this.prisma.notification.count(queryOptions)

        const notifications = await this.prisma.notification.findMany({
            ...queryOptions,
            take,
            skip,
            select: {
                id: true,
                topic: true,
                message: true,
                link: true,
                type: true,
                sent: true,
                sentPayload: true,
                metadata: true,
                sentAt: true,
                error: true,
                userId: true,
                seen: true,
                createdAt: true,
            },
        })

        return {
            meta: {
                curPage,
                perPage,
                total,
            },
            data: notifications.map((notification) => ({
                id: notification.id,
                topic: notification.topic,
                message: notification.message,
                link: notification.link,
                type: notification.type,
                sent: notification.sent,
                sentPayload: notification.sentPayload
                    ? (notification.sentPayload as Record<string, any>)
                    : null,
                metadata: notification.metadata
                    ? (notification.metadata as Record<string, any>)
                    : null,
                sentAt: notification.sentAt?.toISOString(),
                error: notification.error,
                userId: notification.userId,
                seen: notification.seen,
                createdAt: notification.createdAt.toISOString(),
            })),
        }
    }
}
