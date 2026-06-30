import { Injectable, Logger } from '@nestjs/common'

// Minimal client for Expo's push API. The mobile app registers Expo push
// tokens (ExponentPushToken[...]) via /me/firebase-devices, so delivery goes
// through Expo's HTTPS endpoint rather than raw FCM. We talk to it with the
// global fetch (Node >= 18) to avoid pulling in expo-server-sdk and its
// transitive deps into the server image.
//
// https://docs.expo.dev/push-notifications/sending-notifications/

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send'
// Expo accepts at most 100 messages per request.
const MAX_MESSAGES_PER_REQUEST = 100

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

@Injectable()
export class ExpoPushClient {
    private readonly logger = new Logger(ExpoPushClient.name)
    // Not a constructor param: Nest would try to resolve a `String` provider.
    private readonly endpoint = EXPO_PUSH_ENDPOINT

    /**
     * Sends the given messages and returns one ticket per message, in the same
     * order. Throws on a transport / non-2xx error so the caller can leave the
     * rows unsent and retry on the next tick.
     */
    async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
        if (messages.length === 0) return []

        const tickets: ExpoPushTicket[] = []
        for (let i = 0; i < messages.length; i += MAX_MESSAGES_PER_REQUEST) {
            const chunk = messages.slice(i, i + MAX_MESSAGES_PER_REQUEST)
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(
                    chunk.map((m) => ({ sound: 'default', ...m })),
                ),
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

            const payload = (await response.json()) as {
                data?: ExpoPushTicket[]
            }
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
}
