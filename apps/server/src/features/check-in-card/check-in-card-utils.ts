import { createHmac, hkdfSync, timingSafeEqual } from 'crypto'

// The member card a coach scans at the door: `CS1.<userId>.<mac>`, plain text
// (a phone camera shows a meaningless string, not a link). Static per person,
// so the app caches it and shows it offline; the MAC proves it was issued by
// this server, not typed from a known id. Revocation is by key version only
// (a `CS2` prefix with a new HKDF info). docs/design/2026-11-26-door-checkin-and-birthdays.md §1.
const PREFIX = 'CS1'
const MAC_LENGTH = 16
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAC = /^[A-Za-z0-9_-]{16}$/

// HKDF of the server secret, derived once per secret (the process has one).
const keys = new Map<string, Buffer>()
const keyFor = (secret: string): Buffer => {
    let key = keys.get(secret)
    if (!key) {
        key = Buffer.from(
            hkdfSync('sha256', secret, 'clubspace', 'check-in-card/v1', 32),
        )
        keys.set(secret, key)
    }
    return key
}

const macOf = (userId: string, secret: string): string =>
    createHmac('sha256', keyFor(secret))
        .update(`${PREFIX}.${userId}`)
        .digest('base64url')
        .slice(0, MAC_LENGTH)

export const signCheckInCard = (userId: string, secret: string): string =>
    `${PREFIX}.${userId}.${macOf(userId, secret)}`

// The card's user id, or null for anything that isn't a card this server
// issued (wrong prefix, malformed id, extra segments, wrong MAC).
export const verifyCheckInCard = (
    card: string,
    secret: string,
): string | null => {
    const parts = card.split('.')
    if (parts.length !== 3) return null
    const [prefix, userId, mac] = parts
    if (prefix !== PREFIX || !UUID.test(userId) || !MAC.test(mac)) return null
    const expected = Buffer.from(macOf(userId, secret))
    const given = Buffer.from(mac)
    return timingSafeEqual(expected, given) ? userId : null
}
