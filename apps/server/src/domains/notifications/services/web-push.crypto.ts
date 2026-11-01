import {
    createCipheriv,
    createECDH,
    createHmac,
    createPrivateKey,
    generateKeyPairSync,
    randomBytes,
    sign,
} from 'node:crypto'

// Web Push without the `web-push` package: message encryption (RFC 8291,
// aes128gcm content coding from RFC 8188) and VAPID (RFC 8292) on node:crypto.
// Pure functions — the HTTP side lives in WebPushClient.

export type WebPushKeys = {
    /** Browser's P-256 public key, uncompressed point, base64url (65 bytes). */
    p256dh: string
    /** Browser's auth secret, base64url (16 bytes). */
    auth: string
}

export type VapidKeys = {
    /** Uncompressed P-256 public point, base64url — the applicationServerKey. */
    publicKey: string
    /** The private scalar d, base64url (32 bytes). */
    privateKey: string
}

// One record holds the whole payload; push services cap bodies at 4096 bytes.
const RECORD_SIZE = 4096
// 4096 − header (86) − padding delimiter (1) − GCM tag (16).
export const WEB_PUSH_MAX_PAYLOAD = RECORD_SIZE - 86 - 1 - 16

export const b64url = (buf: Buffer): string => buf.toString('base64url')
export const fromB64url = (s: string): Buffer => Buffer.from(s, 'base64url')

const hmac = (key: Buffer, data: Buffer): Buffer =>
    createHmac('sha256', key).update(data).digest()

// HKDF with a single-block expand (every length here is ≤ 32).
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer =>
    hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(
        0,
        length,
    )

export const generateVapidKeys = (): VapidKeys => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
    })
    const pub = publicKey.export({ format: 'jwk' })
    const priv = privateKey.export({ format: 'jwk' })
    return {
        publicKey: b64url(
            Buffer.concat([
                Buffer.from([4]),
                fromB64url(pub.x as string),
                fromB64url(pub.y as string),
            ]),
        ),
        privateKey: priv.d as string,
    }
}

/** Throws unless the pair is a valid P-256 key pair in the expected encoding. */
export const assertVapidKeys = (keys: VapidKeys): void => {
    const pub = fromB64url(keys.publicKey)
    const d = fromB64url(keys.privateKey)
    if (pub.length !== 65 || pub[0] !== 4) {
        throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 point (65 bytes)')
    }
    if (d.length !== 32) {
        throw new Error('WEB_PUSH_VAPID_PRIVATE_KEY must be a base64url P-256 private key (32 bytes)')
    }
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(d)
    if (!ecdh.getPublicKey().equals(pub)) {
        throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY does not match WEB_PUSH_VAPID_PRIVATE_KEY')
    }
}

/**
 * RFC 8291 §3–4: encrypts `plaintext` for one subscription. Returns the full
 * request body (aes128gcm header + single record).
 *
 * `serverKey`/`salt` are injectable only so the RFC 8291 Appendix A vector can
 * be reproduced in tests; production always uses fresh random values.
 */
export const encryptWebPushPayload = (
    keys: WebPushKeys,
    plaintext: Buffer,
    opts: { serverPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer => {
    if (plaintext.length > WEB_PUSH_MAX_PAYLOAD) {
        throw new Error(`web push payload too large (${plaintext.length} bytes)`)
    }
    const uaPublic = fromB64url(keys.p256dh)
    const authSecret = fromB64url(keys.auth)
    if (uaPublic.length !== 65 || uaPublic[0] !== 4) {
        throw new Error('invalid p256dh key')
    }
    if (authSecret.length < 16) throw new Error('invalid auth secret')

    const ecdh = createECDH('prime256v1')
    if (opts.serverPrivateKey) ecdh.setPrivateKey(opts.serverPrivateKey)
    else ecdh.generateKeys()
    const asPublic = ecdh.getPublicKey()
    const ecdhSecret = ecdh.computeSecret(uaPublic)
    const salt = opts.salt ?? randomBytes(16)

    const ikm = hkdf(
        authSecret,
        ecdhSecret,
        Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
        32,
    )
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

    const cipher = createCipheriv('aes-128-gcm', cek, nonce)
    const record = Buffer.concat([
        // 0x02: last-record padding delimiter, no extra padding.
        cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
        cipher.final(),
        cipher.getAuthTag(),
    ])

    const header = Buffer.alloc(16 + 4 + 1)
    salt.copy(header, 0)
    header.writeUInt32BE(RECORD_SIZE, 16)
    header.writeUInt8(asPublic.length, 20)
    return Buffer.concat([header, asPublic, record])
}

/**
 * RFC 8292: `Authorization: vapid t=<JWT>, k=<public key>` for the push
 * service at `endpoint`. The JWT is ES256 over {aud, exp, sub}.
 */
export const vapidAuthorization = (
    endpoint: string,
    keys: VapidKeys,
    subject: string,
    now: Date = new Date(),
): string => {
    const pub = fromB64url(keys.publicKey)
    const key = createPrivateKey({
        key: {
            kty: 'EC',
            crv: 'P-256',
            d: keys.privateKey,
            x: b64url(pub.subarray(1, 33)),
            y: b64url(pub.subarray(33, 65)),
        },
        format: 'jwk',
    })
    const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
    const claims = b64url(
        Buffer.from(
            JSON.stringify({
                aud: new URL(endpoint).origin,
                // Max 24h per RFC 8292; 12h keeps clear of clock skew.
                exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
                sub: subject,
            }),
        ),
    )
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
        key,
        dsaEncoding: 'ieee-p1363',
    })
    return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`
}
