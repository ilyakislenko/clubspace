import { Inject, Injectable, Logger, Optional } from '@nestjs/common'

import { environment } from '../../environments/environment'

// Minimal client for the Telegram Bot API (https://core.telegram.org/bots/api),
// global fetch like the Expo and Web Push clients — no SDK in the image.
const API_ORIGIN = 'https://api.telegram.org'
// A hung connection must fail the job (and let BullMQ retry it) instead of
// pinning a worker slot.
const REQUEST_TIMEOUT_MS = 10_000
// sendMessage refuses longer texts.
export const TELEGRAM_MAX_TEXT = 4096

// Overrides environment.telegram (specs); nothing provides it in the app.
export const TELEGRAM_CONFIG = Symbol('TELEGRAM_CONFIG')

export type TelegramConfig = {
    botToken: string | null
    botUsername: string | null
    webhookSecret: string | null
}

export type TelegramSendResult =
    | { status: 'ok' }
    // 403: the user blocked the bot or deleted the chat — unlink it.
    | { status: 'blocked'; message: string }
    // Worth retrying: 429, 5xx, transport errors, timeouts.
    | { status: 'transient'; message: string }
    // A permanent error for this message (400 and the like).
    | { status: 'error'; message: string }

type ApiReply = { ok?: boolean; description?: string }

@Injectable()
export class TelegramBotClient {
    private readonly logger = new Logger(TelegramBotClient.name)
    private readonly config: TelegramConfig

    constructor(@Optional() @Inject(TELEGRAM_CONFIG) config?: TelegramConfig) {
        this.config = config ?? environment.telegram
    }

    // Linking needs the deep link (username) and a webhook that can verify
    // Telegram (secret); without either the feature stays hidden.
    get available(): boolean {
        const { botToken, botUsername, webhookSecret } = this.config
        return Boolean(botToken && botUsername && webhookSecret)
    }

    get botUsername(): string | null {
        return this.config.botUsername
    }

    get webhookSecret(): string | null {
        return this.config.webhookSecret
    }

    /** Plain-text message to a chat. Never throws: the outcome is classified. */
    async sendMessage(chatId: string, text: string): Promise<TelegramSendResult> {
        const { botToken } = this.config
        if (!botToken) return { status: 'error', message: 'telegram bot is not configured' }
        let response: Response
        try {
            response = await fetch(`${API_ORIGIN}/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: text.slice(0, TELEGRAM_MAX_TEXT),
                    link_preview_options: { is_disabled: true },
                }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
        } catch (err) {
            return {
                status: 'transient',
                message: `telegram: ${err instanceof Error ? err.message : String(err)}`,
            }
        }
        if (response.ok) return { status: 'ok' }
        const reply = (await response.json().catch(() => ({}))) as ApiReply
        const message = `telegram ${response.status}: ${(reply.description ?? '').slice(0, 300)}`
        if (response.status === 403) return { status: 'blocked', message }
        if (response.status === 429 || response.status >= 500) {
            return { status: 'transient', message }
        }
        this.logger.warn(message)
        return { status: 'error', message }
    }
}
