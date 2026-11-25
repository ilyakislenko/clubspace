import { createHmac, hkdfSync, timingSafeEqual } from 'crypto'

// The one-click «Отписаться от писем клуба» link in a club message e-mail:
// `<userId>.<mac>`, no login. The MAC proves this server issued it for that
// person; it never expires (an unsubscribe link must keep working). Revocation
// is by key version (a new HKDF info).
const MAC_LENGTH = 22
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const keys = new Map<string, Buffer>()
const macOf = (userId: string, secret: string): string => {
    let key = keys.get(secret)
    if (!key) {
        key = Buffer.from(
            hkdfSync('sha256', secret, 'clubspace', 'club-messages-unsubscribe/v1', 32),
        )
        keys.set(secret, key)
    }
    return createHmac('sha256', key).update(userId).digest('base64url').slice(0, MAC_LENGTH)
}

export const signUnsubscribeToken = (userId: string, secret: string): string =>
    `${userId}.${macOf(userId, secret)}`

// The token's user id, or null for anything this server didn't issue.
export const verifyUnsubscribeToken = (token: string, secret: string): string | null => {
    const parts = token.split('.')
    if (parts.length !== 2) return null
    const [userId, mac] = parts
    if (!UUID.test(userId) || mac.length !== MAC_LENGTH) return null
    const expected = Buffer.from(macOf(userId, secret))
    const given = Buffer.from(mac)
    return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null
}

export const clubMessagesUnsubscribeUrl = (rootUrl: string, userId: string, secret: string) =>
    `${rootUrl.replace(/\/+$/, '')}/public/unsubscribe/club-messages?token=${signUnsubscribeToken(userId, secret)}`
