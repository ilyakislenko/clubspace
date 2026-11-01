import { Injectable } from '@nestjs/common'

import {
    NotificationTypeEnum,
    Prisma,
    PrismaService,
} from '../../../infrastructure/prisma'
import {
    EXPO_MAX_MESSAGES_PER_REQUEST,
    ExpoPushClient,
    ExpoPushMessage,
} from './expo-push.client'
import { WebPushClient, type WebPushTarget } from './web-push.client'

// Don't deliver ancient rows: after downtime we don't want to suddenly fire a
// reminder for a session that already happened. Older rows are left unsent.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
// The sweep only re-enqueues rows that had time to go through the queue.
const SWEEP_GRACE_MS = 2 * 60_000
const SWEEP_LIMIT = 1000

export const NO_DEVICE_ERROR = 'no registered device'

type PendingRow = {
    id: string
    userId: string
    topic: string
    message: string
    link: string | null
    metadata: unknown
}

export type PushDeliveryResult = {
    // Rows at least one device or browser accepted.
    delivered: number
    // Rows put back to pending after a transport or transient error.
    retry: number
    // Accepted Expo tickets, to check receipts for later.
    tickets: { id: string; token: string }[]
}

type WebTarget = WebPushTarget & { userId: string }

// What happened to one row across all of its user's devices and browsers.
type RowOutcome = {
    accepted: number
    transient: number
    errors: string[]
    ticketIds: string[]
}

// Parallel requests to browser push services within one job.
const WEB_PUSH_CONCURRENCY = 10

const rowData = (row: PendingRow): Record<string, unknown> => ({
    notificationId: row.id,
    link: row.link ?? undefined,
    ...(typeof row.metadata === 'object' && row.metadata
        ? (row.metadata as Record<string, unknown>)
        : {}),
})

const groupByUser = <T extends { userId: string }>(items: T[]) => {
    const map = new Map<string, T[]>()
    for (const item of items) {
        const list = map.get(item.userId)
        if (list) list.push(item)
        else map.set(item.userId, [item])
    }
    return map
}

@Injectable()
export class PushDeliveryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly expo: ExpoPushClient,
        private readonly webPush: WebPushClient,
    ) {}

    /**
     * Delivers the given PUSH notification rows to every Expo device token and
     * browser Web Push subscription of the recipient. A user only receives
     * anything if they registered a device or subscribed a browser (i.e.
     * granted push permission), so those registries are the de-facto consent
     * gate; preferences and mutes are applied when the rows are written.
     *
     * Rows are claimed (sent = true) in one atomic UPDATE before sending, so a
     * duplicate job — a retry, or the sweep re-enqueueing a row whose job is
     * still in backoff — finds nothing left to send. A row that no target
     * accepted and that failed transiently is put back to pending and reported
     * in `retry`.
     */
    async deliver(
        ids: string[],
        now: Date = new Date(),
    ): Promise<PushDeliveryResult> {
        const result: PushDeliveryResult = { delivered: 0, retry: 0, tickets: [] }
        if (ids.length === 0) return result

        const rows: PendingRow[] =
            await this.prisma.notification.updateManyAndReturn({
                where: {
                    id: { in: ids },
                    type: NotificationTypeEnum.PUSH,
                    sent: false,
                    createdAt: { gte: new Date(now.getTime() - MAX_AGE_MS) },
                },
                data: { sent: true, sentAt: now },
                select: {
                    id: true,
                    userId: true,
                    topic: true,
                    message: true,
                    link: true,
                    metadata: true,
                },
            })
        if (rows.length === 0) return result

        const userIds = [...new Set(rows.map((r) => r.userId))]
        const [devices, webSubs] = await Promise.all([
            this.prisma.firebaseDevice.findMany({
                where: { userId: { in: userIds } },
                select: { userId: true, token: true },
            }),
            // Without VAPID keys nothing can be sent to a browser: such rows
            // count as "no device" rather than failing.
            this.webPush.publicKey
                ? this.prisma.webPushSubscription.findMany({
                      where: { userId: { in: userIds } },
                      select: { userId: true, endpoint: true, p256dh: true, auth: true },
                  })
                : Promise.resolve([] as WebTarget[]),
        ])
        const tokensByUser = new Map(
            [...groupByUser(devices)].map(([u, list]) => [u, list.map((d) => d.token)]),
        )
        const webByUser = groupByUser<WebTarget>(webSubs)

        const outcomes = new Map<string, RowOutcome>()
        const noDevice: string[] = []
        for (const row of rows) {
            if (!tokensByUser.has(row.userId) && !webByUser.has(row.userId)) {
                noDevice.push(row.id)
            } else {
                outcomes.set(row.id, { accepted: 0, transient: 0, errors: [], ticketIds: [] })
            }
        }
        const deliverable = rows.filter((r) => outcomes.has(r.id))

        const writes: Prisma.PrismaPromise<unknown>[] = []
        const deadTokens = new Set<string>()
        const deadEndpoints = new Set<string>()

        await Promise.all([
            this.sendExpo(deliverable, tokensByUser, outcomes, deadTokens, result),
            this.sendWeb(deliverable, webByUser, outcomes, deadEndpoints),
        ])

        for (const row of deliverable) {
            const o = outcomes.get(row.id) as RowOutcome
            // Done if any target accepted it, or if nothing failed in a way a
            // retry could fix (dead tokens, gone subscriptions, oversized
            // message, bad credentials — those are logged on the row).
            if (o.accepted > 0 || o.transient === 0) {
                if (o.accepted > 0) result.delivered += 1
                writes.push(
                    this.prisma.notification.updateMany({
                        where: { id: row.id },
                        data: {
                            // Ticket ids only — the full Expo response used to
                            // be stored on every row.
                            ...(o.ticketIds.length > 0
                                ? { sentPayload: { ticketIds: o.ticketIds } }
                                : {}),
                            error: o.errors.length > 0 ? o.errors.join('; ') : null,
                        },
                    }),
                )
            } else {
                result.retry += 1
                writes.push(
                    this.prisma.notification.updateMany({
                        where: { id: row.id },
                        data: { sent: false, sentAt: null, error: o.errors.join('; ') },
                    }),
                )
            }
        }

        if (noDevice.length > 0) {
            // Nothing to deliver to: the row stays an inbox entry only.
            writes.push(
                this.prisma.notification.updateMany({
                    where: { id: { in: noDevice } },
                    data: { error: NO_DEVICE_ERROR },
                }),
            )
        }
        if (deadTokens.size > 0) {
            writes.push(
                this.prisma.firebaseDevice.deleteMany({
                    where: { token: { in: [...deadTokens] } },
                }),
            )
        }
        if (deadEndpoints.size > 0) {
            writes.push(
                this.prisma.webPushSubscription.deleteMany({
                    where: { endpoint: { in: [...deadEndpoints] } },
                }),
            )
        }
        await this.prisma.$transaction(writes)
        return result
    }

    private async sendExpo(
        rows: PendingRow[],
        tokensByUser: Map<string, string[]>,
        outcomes: Map<string, RowOutcome>,
        deadTokens: Set<string>,
        result: PushDeliveryResult,
    ): Promise<void> {
        // Pack rows into Expo-request-sized batches without splitting a row, so
        // a failed request affects exactly the rows it carried.
        const batches: { row: PendingRow; tokens: string[] }[][] = []
        let batch: { row: PendingRow; tokens: string[] }[] = []
        let batchSize = 0
        for (const row of rows) {
            const tokens = tokensByUser.get(row.userId)
            if (!tokens) continue
            if (
                batch.length > 0 &&
                batchSize + tokens.length > EXPO_MAX_MESSAGES_PER_REQUEST
            ) {
                batches.push(batch)
                batch = []
                batchSize = 0
            }
            batch.push({ row, tokens })
            batchSize += tokens.length
        }
        if (batch.length > 0) batches.push(batch)

        for (const entries of batches) {
            let tickets
            try {
                tickets = await this.expo.send(
                    entries.flatMap(({ row, tokens }) =>
                        tokens.map(
                            (to): ExpoPushMessage => ({
                                to,
                                title: row.topic,
                                body: row.message,
                                data: rowData(row),
                            }),
                        ),
                    ),
                )
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err)
                for (const { row, tokens } of entries) {
                    const o = outcomes.get(row.id) as RowOutcome
                    o.transient += tokens.length
                    o.errors.push(error)
                }
                continue
            }

            let i = 0
            for (const { row, tokens } of entries) {
                const o = outcomes.get(row.id) as RowOutcome
                for (const token of tokens) {
                    const ticket = tickets[i++]
                    if (!ticket) {
                        o.errors.push('no ticket returned')
                        o.transient += 1
                    } else if (ticket.status === 'ok') {
                        o.accepted += 1
                        o.ticketIds.push(ticket.id)
                        result.tickets.push({ id: ticket.id, token })
                    } else {
                        o.errors.push(ticket.message)
                        const code = ticket.details?.error
                        if (code === 'DeviceNotRegistered') deadTokens.add(token)
                        if (code === 'MessageRateExceeded') o.transient += 1
                    }
                }
            }
        }
    }

    private async sendWeb(
        rows: PendingRow[],
        webByUser: Map<string, WebTarget[]>,
        outcomes: Map<string, RowOutcome>,
        deadEndpoints: Set<string>,
    ): Promise<void> {
        const jobs = rows.flatMap((row) =>
            (webByUser.get(row.userId) ?? []).map((target) => ({ row, target })),
        )
        for (let i = 0; i < jobs.length; i += WEB_PUSH_CONCURRENCY) {
            await Promise.all(
                jobs.slice(i, i + WEB_PUSH_CONCURRENCY).map(async ({ row, target }) => {
                    const res = await this.webPush.send(target, {
                        title: row.topic,
                        body: row.message,
                        data: rowData(row),
                    })
                    const o = outcomes.get(row.id) as RowOutcome
                    if (res.status === 'ok') {
                        o.accepted += 1
                        return
                    }
                    o.errors.push(res.message)
                    if (res.status === 'gone') deadEndpoints.add(target.endpoint)
                    if (res.status === 'transient') o.transient += 1
                }),
            )
        }
    }

    /** Pending rows old enough that their enqueue was evidently lost. */
    async findStalePending(now: Date = new Date()): Promise<string[]> {
        const rows = await this.prisma.notification.findMany({
            where: {
                type: NotificationTypeEnum.PUSH,
                sent: false,
                createdAt: {
                    gte: new Date(now.getTime() - MAX_AGE_MS),
                    lte: new Date(now.getTime() - SWEEP_GRACE_MS),
                },
            },
            orderBy: { createdAt: 'asc' },
            take: SWEEP_LIMIT,
            select: { id: true },
        })
        return rows.map((r) => r.id)
    }

    /**
     * Expo reports an uninstalled app only in the receipt, not the ticket.
     * Drops tokens whose receipt says DeviceNotRegistered; returns how many.
     */
    async pruneFromReceipts(
        tickets: { id: string; token: string }[],
    ): Promise<number> {
        if (tickets.length === 0) return 0
        const receipts = await this.expo.getReceipts(tickets.map((t) => t.id))
        const dead = new Set<string>()
        for (const t of tickets) {
            const receipt = receipts[t.id]
            if (
                receipt?.status === 'error' &&
                receipt.details?.error === 'DeviceNotRegistered'
            ) {
                dead.add(t.token)
            }
        }
        if (dead.size === 0) return 0
        const { count } = await this.prisma.firebaseDevice.deleteMany({
            where: { token: { in: [...dead] } },
        })
        return count
    }
}
