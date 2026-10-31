import { Injectable, Logger } from '@nestjs/common'

// Minimal client for Expo's push API. The mobile app registers Expo push
// tokens (ExponentPushToken[...]) via /me/firebase-devices, so delivery goes
// through Expo's HTTPS endpoint rather than raw FCM. We talk to it with the
// global fetch (Node >= 18) to avoid pulling in expo-server-sdk and its
// transitive deps into the server image.
//
// https://docs.expo.dev/push-notifications/sending-notifications/

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts'
// Expo accepts at most 100 messages per send and 1000 ids per receipt lookup.
export const EXPO_MAX_MESSAGES_PER_REQUEST = 100
const MAX_RECEIPT_IDS_PER_REQUEST = 1000
// A hung connection must fail the job (and let BullMQ retry it) instead of
// pinning a worker slot forever.
const REQUEST_TIMEOUT_MS = 15_000

export interface ExpoPushMessage {
    to: string
    title: string
    body: string
    data?: Record<string, unknown>
    sound?: 'default' | null
}

export type ExpoPushTicket =
    | { status: 'ok'; id: string }
    | {
          status: 'error'
          message: string
          details?: { error?: string }
      }

export type ExpoPushReceipt =
    | { status: 'ok' }
    | {
          status: 'error'
          message: string
          details?: { error?: string }
      }

@Injectable()
export class ExpoPushClient {
    private readonly logger = new Logger(ExpoPushClient.name)

    /**
     * Sends the given messages and returns one ticket per message, in the same
     * order. Throws on a transport / non-2xx error / timeout so the caller can
     * leave the rows unsent and retry.
     */
    async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
        if (messages.length === 0) return []

        const tickets: ExpoPushTicket[] = []
        for (
            let i = 0;
            i < messages.length;
            i += EXPO_MAX_MESSAGES_PER_REQUEST
        ) {
            const chunk = messages.slice(i, i + EXPO_MAX_MESSAGES_PER_REQUEST)
            const payload = await this.post<{ data?: ExpoPushTicket[] }>(
                EXPO_PUSH_ENDPOINT,
                chunk.map((m) => ({ sound: 'default', ...m })),
            )
            const chunkTickets = payload.data ?? []
            if (chunkTickets.length !== chunk.length) {
                this.logger.warn(
                    `Expo returned ${chunkTickets.length} tickets for ${chunk.length} messages`,
                )
            }
            tickets.push(...chunkTickets)
        }

        return tickets
    }

    /**
     * Looks up delivery receipts by ticket id. Receipts that aren't ready yet
     * are simply absent from the result.
     */
    async getReceipts(
        ticketIds: string[],
    ): Promise<Record<string, ExpoPushReceipt>> {
        const receipts: Record<string, ExpoPushReceipt> = {}
        for (
            let i = 0;
            i < ticketIds.length;
            i += MAX_RECEIPT_IDS_PER_REQUEST
        ) {
            const ids = ticketIds.slice(i, i + MAX_RECEIPT_IDS_PER_REQUEST)
            const payload = await this.post<{
                data?: Record<string, ExpoPushReceipt>
            }>(EXPO_RECEIPTS_ENDPOINT, { ids })
            Object.assign(receipts, payload.data ?? {})
        }
        return receipts
    }

    private async post<T>(url: string, body: unknown): Promise<T> {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })

        if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(
                `Expo push API responded ${response.status}: ${text.slice(
                    0,
                    500,
                )}`,
            )
        }

        return (await response.json()) as T
    }
}
