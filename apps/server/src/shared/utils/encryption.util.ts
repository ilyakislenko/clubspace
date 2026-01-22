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
    const [ivHex, tagHex, dataHex] = payload.split('.')

    if (!ivHex || !tagHex || !dataHex) {
        throw new Error('Invalid encrypted payload')
    }

    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const data = Buffer.from(dataHex, 'hex')
    const key = deriveKey(secret)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
    return decrypted.toString('utf8')
}
