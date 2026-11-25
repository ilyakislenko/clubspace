import { signCheckInCard, verifyCheckInCard } from './check-in-card-utils'

const SECRET = 'test-encryption-secret'
const USER = '0b9f2a4e-5d6c-4f3b-9a1e-7c8d9e0f1a2b'
const OTHER = '1c0a3b5f-6e7d-4a4c-8b2f-8d9e0f1a2b3c'

describe('check-in card', () => {
    it('round-trips: a signed card verifies to its user id', () => {
        const card = signCheckInCard(USER, SECRET)
        expect(card).toMatch(/^CS1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/)
        expect(verifyCheckInCard(card, SECRET)).toBe(USER)
    })

    it('has one fixed length for every user', () => {
        expect(signCheckInCard(USER, SECRET)).toHaveLength(4 + 36 + 1 + 16)
        expect(signCheckInCard(OTHER, SECRET)).toHaveLength(4 + 36 + 1 + 16)
    })

    it('gives each user a different MAC', () => {
        const mac = (id: string) => signCheckInCard(id, SECRET).split('.')[2]
        expect(mac(USER)).not.toBe(mac(OTHER))
    })

    it('is static per user and secret (cacheable offline)', () => {
        expect(signCheckInCard(USER, SECRET)).toBe(signCheckInCard(USER, SECRET))
    })

    it('refuses a card signed with another secret', () => {
        expect(verifyCheckInCard(signCheckInCard(USER, 'other'), SECRET)).toBeNull()
    })

    it('refuses a wrong MAC and a MAC moved to another user', () => {
        const card = signCheckInCard(USER, SECRET)
        const flipped = card.slice(0, -1) + (card.endsWith('A') ? 'B' : 'A')
        expect(verifyCheckInCard(flipped, SECRET)).toBeNull()
        const mac = card.split('.')[2]
        expect(verifyCheckInCard(`CS1.${OTHER}.${mac}`, SECRET)).toBeNull()
    })

    it.each([
        ['a wrong prefix', (c: string) => c.replace(/^CS1/, 'CS2')],
        ['a malformed uuid', (c: string) => c.replace(USER, 'not-a-uuid')],
        ['an upper-case uuid', (c: string) => c.replace(USER, USER.toUpperCase())],
        ['an extra segment', (c: string) => `${c}.x`],
        ['a missing segment', (c: string) => c.split('.').slice(0, 2).join('.')],
        ['a short MAC', (c: string) => c.slice(0, -1)],
        ['a join link', () => 'https://clubspace.ru/join/ABC123'],
        ['an empty string', () => ''],
    ])('refuses %s', (_label, mutate) => {
        expect(verifyCheckInCard(mutate(signCheckInCard(USER, SECRET)), SECRET)).toBeNull()
    })
})
