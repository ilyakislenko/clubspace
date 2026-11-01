import { Injectable, Logger } from '@nestjs/common'

import { environment } from '../../../environments/environment'
import {
    assertVapidKeys,
    encryptWebPushPayload,
    type VapidKeys,
    vapidAuthorization,
    type WebPushKeys,
} from './web-push.crypto'

// Same reasoning as Expo: a hung push service must fail the job, not pin a slot.
const REQUEST_TIMEOUT_MS = 15_000
// Delivery attempts by the push service while the browser is offline.
const TTL_SECONDS = 24 * 60 * 60

export type WebPushTarget = WebPushKeys & { endpoint: string }

export type WebPushPayload = {
    title: string
    body: string
    /** The notification's metadata (`kind`, ids) the app routes a click by. */
    data?: Record<string, unknown>
}

export type WebPushSendResult =
    | { status: 'ok' }
    // The subscription is gone (404/410) — drop it.
    | { status: 'gone'; message: string }
    // Worth retrying: 429, 5xx, transport errors, timeouts.
    | { status: 'transient'; message: string }
    // A permanent error for this message (400, 413, 401/403 bad VAPID…).
    | { status: 'error'; message: string }

/**
 * Sends one encrypted message to one browser push subscription. Talks to the
 * push service (FCM, Mozilla autopush, Apple) directly with the global fetch.
 * Never throws: the outcome is classified for the delivery service.
 */
@Injectable()
export class WebPushClient {
    private readonly logger = new Logger(WebPushClient.name)
    private readonly keys: VapidKeys | null

    constructor() {
        const { publicKey, privateKey } = environment.webPush
        if (publicKey && privateKey) {
            const keys = { publicKey, privateKey }
            try {
                assertVapidKeys(keys)
                this.keys = keys
            } catch (err) {
                // A broken pair must not take the API down: only web push is off.
                this.logger.error(
                    `Web push disabled: ${err instanceof Error ? err.message : String(err)}`,
                )
                this.keys = null
            }
        } else {
            this.keys = null
        }
    }

    /** The applicationServerKey browsers subscribe with; null when off. */
    get publicKey(): string | null {
        return this.keys?.publicKey ?? null
    }

    async send(
        target: WebPushTarget,
        payload: WebPushPayload,
    ): Promise<WebPushSendResult> {
        if (!this.keys) return { status: 'error', message: 'web push is not configured' }
        let body: Buffer
        let authorization: string
        try {
            body = encryptWebPushPayload(
                target,
                Buffer.from(JSON.stringify(payload)),
            )
            authorization = vapidAuthorization(
                target.endpoint,
                this.keys,
                environment.webPush.subject,
            )
        } catch (err) {
            return {
                status: 'error',
                message: err instanceof Error ? err.message : String(err),
            }
        }

        let res: Response
        try {
            res = await fetch(target.endpoint, {
                method: 'POST',
                headers: {
                    Authorization: authorization,
                    'Content-Encoding': 'aes128gcm',
                    'Content-Type': 'application/octet-stream',
                    TTL: String(TTL_SECONDS),
                    Urgency: 'normal',
                },
                body,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
        } catch (err) {
            return {
                status: 'transient',
                message: `web push: ${err instanceof Error ? err.message : String(err)}`,
            }
        }
        if (res.ok) return { status: 'ok' }
        const text = (await res.text().catch(() => '')).slice(0, 200)
        const message = `web push ${res.status}${text ? `: ${text}` : ''}`
        if (res.status === 404 || res.status === 410) return { status: 'gone', message }
        if (res.status === 429 || res.status >= 500) return { status: 'transient', message }
        return { status: 'error', message }
    }
}
