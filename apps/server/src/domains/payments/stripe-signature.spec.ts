import {
    signStripePayload,
    verifyStripeSignature,
} from './stripe-signature'

const secret = 'whsec_test_secret'
const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })
const now = 1_800_000_000

const header = (t: number, sig: string) => `t=${t},v1=${sig}`

describe('verifyStripeSignature', () => {
    const good = signStripePayload(payload, secret, now)

    it('accepts a correct signature within the tolerance', () => {
        expect(
            verifyStripeSignature({
                payload,
                header: header(now - 60, signStripePayload(payload, secret, now - 60)),
                secret,
                nowSeconds: now,
            }),
        ).toBe(true)
        expect(
            verifyStripeSignature({
                payload: Buffer.from(payload),
                header: header(now, good),
                secret,
                nowSeconds: now,
            }),
        ).toBe(true)
    })

    it('accepts when any of several v1 signatures matches (secret rotation)', () => {
        expect(
            verifyStripeSignature({
                payload,
                header: `t=${now},v1=${'0'.repeat(64)},v1=${good},v0=abc`,
                secret,
                nowSeconds: now,
            }),
        ).toBe(true)
    })

    it('refuses a tampered body, a wrong secret and a garbage signature', () => {
        expect(
            verifyStripeSignature({
                payload: payload.replace('evt_1', 'evt_2'),
                header: header(now, good),
                secret,
                nowSeconds: now,
            }),
        ).toBe(false)
        expect(
            verifyStripeSignature({
                payload,
                header: header(now, signStripePayload(payload, 'whsec_other', now)),
                secret,
                nowSeconds: now,
            }),
        ).toBe(false)
        expect(
            verifyStripeSignature({
                payload,
                header: header(now, 'zz'),
                secret,
                nowSeconds: now,
            }),
        ).toBe(false)
    })

    it('refuses a replay outside the 5-minute tolerance (both directions)', () => {
        const old = now - 301
        expect(
            verifyStripeSignature({
                payload,
                header: header(old, signStripePayload(payload, secret, old)),
                secret,
                nowSeconds: now,
            }),
        ).toBe(false)
        const future = now + 301
        expect(
            verifyStripeSignature({
                payload,
                header: header(future, signStripePayload(payload, secret, future)),
                secret,
                nowSeconds: now,
            }),
        ).toBe(false)
    })

    it('refuses a missing or malformed header', () => {
        for (const h of [undefined, '', 'v1=abc', `t=${now}`, 't=x,v1=abc']) {
            expect(
                verifyStripeSignature({ payload, header: h, secret, nowSeconds: now }),
            ).toBe(false)
        }
    })

    it('does not accept the signature of another timestamp', () => {
        expect(
            verifyStripeSignature({
                payload,
                header: header(now - 10, good),
                secret,
                nowSeconds: now,
            }),
        ).toBe(false)
    })
})
