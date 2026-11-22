import { createHash, randomBytes, timingSafeEqual } from 'crypto'

import { TELEGRAM_MAX_TEXT } from './telegram-bot.client'

// «Подключить Telegram»: the deep link carries a one-time token the bot gets
// back as `/start <token>`. Only the SHA-256 is stored.
export const TELEGRAM_LINK_TTL_MS = 15 * 60_000

export const hashTelegramLinkToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex')

// 24 random bytes → 32 base64url characters: inside Telegram's start
// parameter alphabet (A-Z a-z 0-9 _ -) and 64-character limit.
export const generateTelegramLinkToken = (): { token: string; hash: string } => {
    const token = randomBytes(24).toString('base64url')
    return { token, hash: hashTelegramLinkToken(token) }
}

// Cheap shape check before a database lookup.
export const looksLikeTelegramLinkToken = (value: string): boolean =>
    /^[A-Za-z0-9_-]{20,64}$/.test(value)

export const telegramDeepLink = (botUsername: string, token: string): string =>
    `https://t.me/${botUsername}?start=${token}`

export type TelegramBotCommand =
    | { command: 'start'; arg: string | null }
    | { command: 'stop' }

// `/start <token>`, `/start`, `/stop`, also in the `/start@BotName` form a
// client sends from a command menu. Anything else → null.
export const parseTelegramCommand = (text: string): TelegramBotCommand | null => {
    const m = /^\/(start|stop)(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text.trim())
    if (!m) return null
    return m[1] === 'stop' ? { command: 'stop' } : { command: 'start', arg: m[2] ?? null }
}

// Constant-time comparison of the X-Telegram-Bot-Api-Secret-Token header.
// Digests first, so the lengths always match.
export const telegramSecretMatches = (
    expected: string,
    given: string | undefined,
): boolean => {
    if (!given) return false
    const a = createHash('sha256').update(expected).digest()
    const b = createHash('sha256').update(given).digest()
    return timingSafeEqual(a, b)
}

const isHttpUrl = (value: string | null | undefined): value is string =>
    typeof value === 'string' && /^https?:\/\//.test(value)

// The Telegram copy of a notification: title, body and where to open it — the
// notification's own link when it is a web address, otherwise the member app.
export const formatTelegramText = (
    row: { topic: string; message: string; link: string | null },
    appUrl: string | null,
): string => {
    const url = isHttpUrl(row.link) ? row.link : appUrl
    const head = [row.topic.trim(), row.message.trim()]
        .filter((part) => part.length > 0)
        .join('\n\n')
    const tail = url ? `\n\n${url}` : ''
    return head.slice(0, TELEGRAM_MAX_TEXT - tail.length) + tail
}
