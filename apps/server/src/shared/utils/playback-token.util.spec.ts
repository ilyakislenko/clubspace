import { createHmac } from 'crypto'

// Mock the env module so the util has a deterministic secret and we don't pull
// in the real environment.ts (which .required()s DATABASE_URL etc. at import).
// The literal is inlined here because jest hoists the factory above any
// outer-scope const it would otherwise reference.
jest.mock('../../environments/environment', () => ({
    environment: {
        playbackTokenSecret: 'test-playback-secret-deterministic-and-long-enough',
    },
}))

const SECRET = 'test-playback-secret-deterministic-and-long-enough'

import { issuePlaybackToken, verifyPlaybackToken } from './playback-token.util'

const signBody = (body: string) =>
    createHmac('sha256', SECRET).update(body).digest('base64url')

const makeToken = (body: string) =>
    `${Buffer.from(body).toString('base64url')}.${signBody(body)}`

const nowSeconds = () => Math.floor(Date.now() / 1000)

describe('playback token', () => {
    it('round-trips an issued token back to its payload', () => {
        const token = issuePlaybackToken({ videoId: 'vid-1', userId: 'user-1' })
        const payload = verifyPlaybackToken(token)
        expect(payload).not.toBeNull()
        expect(payload?.videoId).toBe('vid-1')
        expect(payload?.userId).toBe('user-1')
        expect(payload?.exp).toBeGreaterThan(nowSeconds())
    })

    it('rejects a tampered signature', () => {
        const token = issuePlaybackToken({ videoId: 'vid-1', userId: 'user-1' })
        const [body] = token.split('.')
        const forged = `${body}.${signBody('vid-1:user-1:' + (nowSeconds() + 9999))}`
        // Different body signed → signature won't match the real body.
        expect(verifyPlaybackToken(forged)).toBeNull()
    })

    it('rejects a tampered body (re-using an old signature)', () => {
        const token = issuePlaybackToken({ videoId: 'vid-1', userId: 'user-1' })
        const [, signature] = token.split('.')
        const swappedBody = Buffer.from('vid-1:attacker:' + (nowSeconds() + 9999)).toString(
            'base64url',
        )
        expect(verifyPlaybackToken(`${swappedBody}.${signature}`)).toBeNull()
    })

    it('rejects a token signed with the wrong secret', () => {
        const body = `vid-1:user-1:${nowSeconds() + 1000}`
        const wrongSig = createHmac('sha256', 'some-other-secret')
            .update(body)
            .digest('base64url')
        const token = `${Buffer.from(body).toString('base64url')}.${wrongSig}`
        expect(verifyPlaybackToken(token)).toBeNull()
    })

    it('rejects an expired token', () => {
        const token = makeToken(`vid-1:user-1:${nowSeconds() - 10}`)
        expect(verifyPlaybackToken(token)).toBeNull()
    })

    it('accepts a manually-signed, unexpired token', () => {
        const token = makeToken(`vid-2:user-2:${nowSeconds() + 1000}`)
        expect(verifyPlaybackToken(token)?.videoId).toBe('vid-2')
    })

    it('rejects malformed tokens', () => {
        expect(verifyPlaybackToken('')).toBeNull()
        expect(verifyPlaybackToken('garbage')).toBeNull()
        expect(verifyPlaybackToken('only-one-part')).toBeNull()
        expect(verifyPlaybackToken('.')).toBeNull()
    })
})
