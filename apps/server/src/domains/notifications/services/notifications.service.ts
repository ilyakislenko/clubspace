import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'

import {
    NotificationTypeEnum,
    Prisma,
    PrismaService,
} from '../../../infrastructure/prisma'
import { parseMetaArgs } from '../../../shared/utils/parse-meta-args.util'
import { withTimeout } from '../../../shared/utils/with-timeout'
import {
    EMAIL_JOB_OPTS,
    EMAIL_JOB_SEND,
    EMAIL_QUEUE,
    type EmailJobData,
} from '../email-queue'
import {
    SendNotificationPayload,
    UpdateNotificationStatusPayload,
} from '../interfaces/notifications.interfaces'
import { PushQueueService } from './push-queue.service'

// ioredis queues commands while reconnecting; fail instead of hanging.
const ENQUEUE_TIMEOUT_MS = 5_000

@Injectable()
export class NotificationsService {
    constructor(
        private readonly prisma: PrismaService,
        @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
        private readonly push: PushQueueService,
    ) {}

    // Writes the row, then hands delivery to the matching queue. TELEGRAM has
    // no transport yet: its row is an inbox entry only.
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

        if (type === NotificationTypeEnum.EMAIL) {
            await withTimeout(
                this.emailQueue.add(
                    EMAIL_JOB_SEND,
                    { notificationId: id, to: identity } satisfies EmailJobData,
                    EMAIL_JOB_OPTS,
                ),
                ENQUEUE_TIMEOUT_MS,
            )
        } else if (type === NotificationTypeEnum.PUSH) {
            await this.push.enqueue([id])
        }

        return id
    }

    async updateNotificationStatus(
        dto: UpdateNotificationStatusPayload,
    ): Promise<void> {
        const { id, sent, error, sentPayload } = dto

        // updateMany, not update: this runs from a fire-and-forget email
        // listener, long after the HTTP request that triggered it has answered
        // and with nothing awaiting the result. `update` throws P2025 when the
        // row is gone — a user deleted mid-send, a cascade, a cleanup — and
        // there is no caller left to catch it, so it surfaced as an unhandled
        // rejection. Recording the outcome of a notification that no longer
        // exists is a no-op, not a failure.
        await this.prisma.notification.updateMany({
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

    // Acknowledge notifications for a user. With `ids` marks just those;
    // without, marks every unseen one (e.g. on opening the inbox). Scoped to
    // userId so a user can never flip someone else's rows. Returns the count.
    async markSeen(payload: {
        userId: string
        ids?: string[]
    }): Promise<number> {
        const result = await this.prisma.notification.updateMany({
            where: {
                userId: payload.userId,
                seen: false,
                ...(payload.ids && payload.ids.length > 0
                    ? { id: { in: payload.ids } }
                    : {}),
            },
            data: { seen: true },
        })
        return result.count
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
