import { createHmac, timingSafeEqual } from 'crypto'

import { environment } from '../../environments/environment'

const PLAYBACK_TOKEN_TTL_SECONDS = 4 * 60 * 60

const sign = (payload: string) =>
    createHmac('sha256', environment.playbackTokenSecret)
        .update(payload)
        .digest('base64url')

// Constant-time signature comparison. A plain `!==` leaks, via timing, how
// many leading bytes of a forged signature matched — enough to forge a valid
// token byte by byte. Compare equal-length buffers with timingSafeEqual.
const signaturesMatch = (a: string, b: string): boolean => {
    const aBuf = Buffer.from(a)
    const bBuf = Buffer.from(b)
    if (aBuf.length !== bBuf.length) return false
    return timingSafeEqual(aBuf, bBuf)
}

export type PlaybackTokenPayload = {
    videoId: string
    userId: string
    exp: number
}

export const issuePlaybackToken = (payload: {
    videoId: string
    userId: string
}) => {
    const exp = Math.floor(Date.now() / 1000) + PLAYBACK_TOKEN_TTL_SECONDS
    const body = `${payload.videoId}:${payload.userId}:${exp}`
    const signature = sign(body)
    return `${Buffer.from(body).toString('base64url')}.${signature}`
}

export const verifyPlaybackToken = (
    token: string,
): PlaybackTokenPayload | null => {
    const [bodyEncoded, signature] = token.split('.')
    if (!bodyEncoded || !signature) return null

    let body: string
    try {
        body = Buffer.from(bodyEncoded, 'base64url').toString('utf-8')
    } catch {
        return null
    }

    const expected = sign(body)
    if (!signaturesMatch(expected, signature)) return null

    const [videoId, userId, expRaw] = body.split(':')
    const exp = Number(expRaw)
    if (!videoId || !userId || !Number.isFinite(exp)) return null
    if (exp < Math.floor(Date.now() / 1000)) return null

    return { videoId, userId, exp }
}
