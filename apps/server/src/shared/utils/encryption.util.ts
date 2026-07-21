import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

const deriveKey = (secret: string) =>
    createHash('sha256').update(secret).digest()

export function encrypt(value: string, secret: string) {
    const iv = randomBytes(IV_LENGTH)
    const key = deriveKey(secret)
    const cipher = createCipheriv(ALGORITHM, key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return [
        iv.toString('hex'),
        tag.toString('hex'),
        encrypted.toString('hex'),
    ].join('.')
}

export function decrypt(payload: string, secret: string) {
    const parts = payload.split('.')
    // iv and tag must be present; the data segment may legitimately be empty —
    // GCM encrypts an empty plaintext to zero ciphertext bytes, so an empty
    // dataHex is a valid encryption of "", not a malformed payload.
    if (parts.length !== 3 || !parts[0] || !parts[1]) {
        throw new Error('Invalid encrypted payload')
    }
    const [ivHex, tagHex, dataHex] = parts

    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const data = Buffer.from(dataHex, 'hex')
    const key = deriveKey(secret)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return decrypted.toString('utf8')
}
