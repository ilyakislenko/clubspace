import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto'

import {
    assertVapidKeys,
    encryptWebPushPayload,
    fromB64url,
    generateVapidKeys,
    vapidAuthorization,
} from './web-push.crypto'

// RFC 8291 Appendix A.
const RFC = {
    plaintext: 'When I grow up, I want to be a watermelon',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    uaPublic:
        'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    body:
        'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const hkdf = (salt: Buffer, ikm: Buffer, info: string | Buffer, len: number) => {
    const prk = createHmac('sha256', salt).update(ikm).digest()
    return createHmac('sha256', prk)
        .update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
        .digest()
        .subarray(0, len)
}

// What the browser does on receipt (RFC 8291 §3.4), written independently of
// the encrypt side.
const decrypt = (body: Buffer, uaPrivate: Buffer, auth: Buffer): string => {
    const salt = body.subarray(0, 16)
    const idlen = body[20]
    const asPublic = body.subarray(21, 21 + idlen)
    const record = body.subarray(21 + idlen)
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(uaPrivate)
    const ikm = hkdf(
        auth,
        ecdh.computeSecret(asPublic),
        Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]),
        32,
    )
    const decipher = createDecipheriv(
        'aes-128-gcm',
        hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16),
        hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12),
    )
    decipher.setAuthTag(record.subarray(record.length - 16))
    const padded = Buffer.concat([
        decipher.update(record.subarray(0, record.length - 16)),
        decipher.final(),
    ])
    expect(padded[padded.length - 1]).toBe(2)
    return padded.subarray(0, padded.length - 1).toString()
}

describe('web push encryption (RFC 8291)', () => {
    it('reproduces the RFC 8291 Appendix A message byte for byte', () => {
        const body = encryptWebPushPayload(
            { p256dh: RFC.uaPublic, auth: RFC.auth },
            Buffer.from(RFC.plaintext),
            { serverPrivateKey: fromB64url(RFC.asPrivate), salt: fromB64url(RFC.salt) },
        )
        expect(body.toString('base64url')).toBe(RFC.body)
    })

    it('a fresh message decrypts with the browser keys, and differs every time', () => {
        const payload = JSON.stringify({ title: 'Тренировка перенесена', body: 'Ср 19:00 → 20:00' })
        const keys = { p256dh: RFC.uaPublic, auth: RFC.auth }
        const a = encryptWebPushPayload(keys, Buffer.from(payload))
        const b = encryptWebPushPayload(keys, Buffer.from(payload))
        expect(a.equals(b)).toBe(false)
        expect(a.readUInt32BE(16)).toBe(4096)
        expect(decrypt(a, fromB64url(RFC.uaPrivate), fromB64url(RFC.auth))).toBe(payload)
    })

    it('refuses a payload a push service would reject, and malformed keys', () => {
        const keys = { p256dh: RFC.uaPublic, auth: RFC.auth }
        expect(() => encryptWebPushPayload(keys, Buffer.alloc(4000))).toThrow(/too large/)
        expect(() =>
            encryptWebPushPayload({ ...keys, p256dh: 'AAAA' }, Buffer.from('x')),
        ).toThrow(/p256dh/)
    })
})

describe('VAPID (RFC 8292)', () => {
    it('generates a valid pair and signs an ES256 JWT for the endpoint origin', () => {
        const keys = generateVapidKeys()
        expect(() => assertVapidKeys(keys)).not.toThrow()

        const now = new Date('2026-11-01T10:00:00Z')
        const header = vapidAuthorization(
            'https://fcm.googleapis.com/fcm/send/abc:def',
            keys,
            'mailto:ops@clubspace.test',
            now,
        )
        const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
        expect(m).not.toBeNull()
        const [, h, c, sig, k] = m as RegExpExecArray
        expect(k).toBe(keys.publicKey)
        expect(JSON.parse(fromB64url(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
        expect(JSON.parse(fromB64url(c).toString())).toEqual({
            aud: 'https://fcm.googleapis.com',
            exp: now.getTime() / 1000 + 12 * 3600,
            sub: 'mailto:ops@clubspace.test',
        })
        const pub = fromB64url(keys.publicKey)
        const publicKey = createPublicKey({
            key: {
                kty: 'EC',
                crv: 'P-256',
                x: pub.subarray(1, 33).toString('base64url'),
                y: pub.subarray(33).toString('base64url'),
            },
            format: 'jwk',
        })
        expect(
            verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(sig)),
        ).toBe(true)
    })

    it('rejects a mismatched pair', () => {
        const a = generateVapidKeys()
        const b = generateVapidKeys()
        expect(() => assertVapidKeys({ publicKey: a.publicKey, privateKey: b.privateKey })).toThrow(
            /does not match/,
        )
    })
})
