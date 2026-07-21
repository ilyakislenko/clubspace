import { decrypt, encrypt } from './encryption.util'

const SECRET = 'super-secret-key'

describe('encryption.util (aes-256-gcm)', () => {
    it('round-trips a value with the same secret', () => {
        const plain = 'telegram-bot-token-12345'
        expect(decrypt(encrypt(plain, SECRET), SECRET)).toBe(plain)
    })

    it('round-trips unicode', () => {
        expect(decrypt(encrypt('привет 🥋', SECRET), SECRET)).toBe('привет 🥋')
    })

    // GCM encrypts "" to zero ciphertext bytes; the empty data segment is a
    // valid encryption of "", not a malformed payload. Round-trips cleanly.
    it('round-trips the empty string', () => {
        expect(decrypt(encrypt('', SECRET), SECRET)).toBe('')
    })

    it('produces a different ciphertext each time (random IV)', () => {
        expect(encrypt('same', SECRET)).not.toBe(encrypt('same', SECRET))
    })

    it('fails to decrypt with the wrong secret (auth tag mismatch)', () => {
        const payload = encrypt('secret data', SECRET)
        expect(() => decrypt(payload, 'wrong-secret')).toThrow()
    })

    it('fails to decrypt tampered ciphertext', () => {
        const [iv, tag, data] = encrypt('secret data', SECRET).split('.')
        // Flip the last hex nibble of the data segment.
        const flipped = data.slice(0, -1) + (data.endsWith('0') ? '1' : '0')
        expect(() => decrypt(`${iv}.${tag}.${flipped}`, SECRET)).toThrow()
    })

    it('rejects a malformed payload', () => {
        expect(() => decrypt('not-a-valid-payload', SECRET)).toThrow(
            'Invalid encrypted payload',
        )
    })
})
