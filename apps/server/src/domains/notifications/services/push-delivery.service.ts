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
    // Rows at least one device accepted.
    delivered: number
    // Rows put back to pending after a transport or transient Expo error.
    retry: number
    // Accepted tickets, to check receipts for later.
    tickets: { id: string; token: string }[]
}

const toMessage = (row: PendingRow, token: string): ExpoPushMessage => ({
    to: token,
    title: row.topic,
    body: row.message,
    data: {
        notificationId: row.id,
        link: row.link ?? undefined,
        ...(typeof row.metadata === 'object' && row.metadata
            ? (row.metadata as Record<string, unknown>)
            : {}),
    },
})

@Injectable()
export class PushDeliveryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly expo: ExpoPushClient,
    ) {}

    /**
     * Delivers the given PUSH notification rows. A user only receives anything
     * if they have a registered device token (i.e. granted OS push
     * permission), so the device registry is the de-facto consent gate.
     *
     * Rows are claimed (sent = true) in one atomic UPDATE before sending, so a
     * duplicate job — a retry, or the sweep re-enqueueing a row whose job is
     * still in backoff — finds nothing left to send. A row that fails
     * transiently is put back to pending and reported in `retry`.
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

        const devices = await this.prisma.firebaseDevice.findMany({
            where: { userId: { in: [...new Set(rows.map((r) => r.userId))] } },
            select: { userId: true, token: true },
        })
        const tokensByUser = new Map<string, string[]>()
        for (const d of devices) {
            const list = tokensByUser.get(d.userId)
            if (list) list.push(d.token)
            else tokensByUser.set(d.userId, [d.token])
        }

        // Pack rows into Expo-request-sized batches without splitting a row, so
        // a failed request reverts exactly the rows it carried.
        const noDevice: string[] = []
        const batches: { row: PendingRow; tokens: string[] }[][] = []
        let batch: { row: PendingRow; tokens: string[] }[] = []
        let batchSize = 0
        for (const row of rows) {
            const tokens = tokensByUser.get(row.userId) ?? []
            if (tokens.length === 0) {
                noDevice.push(row.id)
                continue
            }
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

        const writes: Prisma.PrismaPromise<unknown>[] = []
        const deadTokens = new Set<string>()
        const revert = (id: string, error: string) => {
            result.retry += 1
            writes.push(
                this.prisma.notification.updateMany({
                    where: { id },
                    data: { sent: false, sentAt: null, error },
                }),
            )
        }

        for (const entries of batches) {
            let tickets
            try {
                tickets = await this.expo.send(
                    entries.flatMap(({ row, tokens }) =>
                        tokens.map((token) => toMessage(row, token)),
                    ),
                )
            } catch (err) {
                const error = err instanceof Error ? err.message : String(err)
                for (const { row } of entries) revert(row.id, error)
                continue
            }

            let i = 0
            for (const { row, tokens } of entries) {
                const ticketIds: string[] = []
                const errors: string[] = []
                let transient = 0
                for (const token of tokens) {
                    const ticket = tickets[i++]
                    if (!ticket) {
                        errors.push('no ticket returned')
                        transient += 1
                    } else if (ticket.status === 'ok') {
                        ticketIds.push(ticket.id)
                        result.tickets.push({ id: ticket.id, token })
                    } else {
                        errors.push(ticket.message)
                        const code = ticket.details?.error
                        if (code === 'DeviceNotRegistered') deadTokens.add(token)
                        if (code === 'MessageRateExceeded') transient += 1
                    }
                }

                // Done if any device accepted it, or if nothing failed in a way
                // a retry could fix (dead tokens, oversized message, bad
                // credentials — those are logged on the row, not retried).
                if (ticketIds.length > 0 || transient === 0) {
                    if (ticketIds.length > 0) result.delivered += 1
                    writes.push(
                        this.prisma.notification.updateMany({
                            where: { id: row.id },
                            data: {
                                // Ticket ids only — the full Expo response
                                // used to be stored on every row.
                                ...(ticketIds.length > 0
                                    ? { sentPayload: { ticketIds } }
                                    : {}),
                                error: errors.length > 0 ? errors.join('; ') : null,
                            },
                        }),
                    )
                } else {
                    revert(row.id, errors.join('; '))
                }
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
        await this.prisma.$transaction(writes)
        return result
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
