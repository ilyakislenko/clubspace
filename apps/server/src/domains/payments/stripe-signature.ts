import { createHmac, timingSafeEqual } from 'crypto'

// Stripe-Signature: `t=<unix seconds>,v1=<hex hmac>[,v1=…][,v0=…]`. The
// signature is HMAC-SHA256 over `${t}.${raw body}` with the endpoint's signing
// secret (whsec_…). https://docs.stripe.com/webhooks#verify-manually
//
// The timestamp is inside the signed payload, so a captured request cannot be
// replayed later with a fresh `t`; the tolerance bounds how late it may arrive.
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60

export const signStripePayload = (
    payload: string | Buffer,
    secret: string,
    timestamp: number,
): string =>
    createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(payload)
        .digest('hex')

const safeEqualHex = (a: string, b: string): boolean => {
    const left = Buffer.from(a, 'hex')
    const right = Buffer.from(b, 'hex')
    // Hex decoding drops invalid characters, so compare decoded lengths too.
    return (
        left.length === right.length &&
        left.length > 0 &&
        a.length === b.length &&
        timingSafeEqual(left, right)
    )
}

export const verifyStripeSignature = (p: {
    payload: string | Buffer
    header: string | undefined
    secret: string
    nowSeconds: number
    toleranceSeconds?: number
}): boolean => {
    if (!p.header) return false
    let timestamp: number | null = null
    const signatures: string[] = []
    for (const part of p.header.split(',')) {
        const eq = part.indexOf('=')
        if (eq === -1) continue
        const key = part.slice(0, eq).trim()
        const value = part.slice(eq + 1).trim()
        if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value)
        if (key === 'v1' && value) signatures.push(value)
    }
    if (timestamp === null || signatures.length === 0) return false
    const tolerance = p.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS
    if (Math.abs(p.nowSeconds - timestamp) > tolerance) return false

    const expected = signStripePayload(p.payload, p.secret, timestamp)
    // Every candidate is compared (no early exit on the first mismatch) so the
    // timing does not reveal which one matched.
    let ok = false
    for (const candidate of signatures) {
        if (safeEqualHex(candidate, expected)) ok = true
    }
    return ok
}
