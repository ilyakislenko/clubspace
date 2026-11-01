import {
    AI_TOKEN_PREFIX,
    aiTokenExpiresAt,
    aiTokenState,
    ENABLED_AI_TOKEN_SCOPES,
    generateAiToken,
    hashAiToken,
    looksLikeAiToken,
} from './ai-token'
import { pseudonymFor, PSEUDONYM_RE } from './pseudonym'

describe('ai tokens', () => {
    it('generates a prefixed secret whose hash is what gets stored', () => {
        const a = generateAiToken()
        const b = generateAiToken()
        expect(a.secret.startsWith(AI_TOKEN_PREFIX)).toBe(true)
        expect(a.secret).not.toBe(b.secret)
        expect(a.hash).toBe(hashAiToken(a.secret))
        expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
        expect(a.hash).not.toContain(a.secret)
        expect(a.secret.startsWith(a.prefix)).toBe(true)
        expect(looksLikeAiToken(a.secret)).toBe(true)
    })

    it('refuses anything that is not shaped like a club token', () => {
        expect(looksLikeAiToken('eyJhbGciOiJIUzI1NiJ9.e30.x')).toBe(false)
        expect(looksLikeAiToken('csai_short')).toBe(false)
        expect(looksLikeAiToken(`csai_${'x'.repeat(200)}`)).toBe(false)
    })

    it('derives the state: revoked wins, then expiry', () => {
        const now = new Date('2026-11-01T10:00:00Z')
        const past = new Date('2026-10-01T00:00:00Z')
        const future = new Date('2026-12-01T00:00:00Z')
        expect(aiTokenState({ revokedAt: null, expiresAt: null }, now)).toBe('active')
        expect(aiTokenState({ revokedAt: null, expiresAt: future }, now)).toBe('active')
        expect(aiTokenState({ revokedAt: null, expiresAt: now }, now)).toBe('expired')
        expect(aiTokenState({ revokedAt: past, expiresAt: past }, now)).toBe('revoked')
    })

    it('computes the expiry from the chosen lifetime', () => {
        const now = new Date('2026-11-01T00:00:00Z')
        expect(aiTokenExpiresAt(now, null)).toBeNull()
        expect(aiTokenExpiresAt(now, 30)?.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    })

    it('grants only read until actions ship', () => {
        expect(ENABLED_AI_TOKEN_SCOPES).toEqual(['read'])
    })
})

describe('pseudonyms', () => {
    it('are stable per club and person, distinct across clubs and kinds', () => {
        const a = pseudonymFor('secret', 'club-a', 'user-1', 'member')
        expect(a).toMatch(PSEUDONYM_RE)
        expect(a.startsWith('m_')).toBe(true)
        expect(pseudonymFor('secret', 'club-a', 'user-1', 'member')).toBe(a)
        expect(pseudonymFor('secret', 'club-b', 'user-1', 'member')).not.toBe(a)
        expect(pseudonymFor('secret', 'club-a', 'user-2', 'member')).not.toBe(a)
        expect(pseudonymFor('other', 'club-a', 'user-1', 'member')).not.toBe(a)
        expect(pseudonymFor('secret', 'club-a', 'user-1', 'staff').startsWith('c_')).toBe(true)
    })
})
