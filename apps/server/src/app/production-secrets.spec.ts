import {
    assertProductionSecrets,
    type ProductionSecretsConfig,
} from './production-secrets'

const STRONG_JWT = 'a'.repeat(64)
const STRONG_PLAYBACK = 'b'.repeat(64)
const STRONG_KEY = 'c'.repeat(64)

const prod = (overrides: Partial<ProductionSecretsConfig> = {}) =>
    assertProductionSecrets({
        production: true,
        jwtSecret: STRONG_JWT,
        playbackTokenSecret: STRONG_PLAYBACK,
        encryptionKey: STRONG_KEY,
        ...overrides,
    })

describe('assertProductionSecrets', () => {
    it('accepts distinct, strong secrets', () => {
        expect(() => prod()).not.toThrow()
    })

    it('ignores everything outside production', () => {
        expect(() =>
            assertProductionSecrets({
                production: false,
                jwtSecret: 'x',
                playbackTokenSecret: undefined,
                encryptionKey: undefined,
            }),
        ).not.toThrow()
    })

    it.each([
        ['JWT_SECRET', { jwtSecret: 'REPLACE_WITH_64_BYTE_HEX_FROM_OPENSSL_RAND' }],
        [
            'PLAYBACK_TOKEN_SECRET',
            { playbackTokenSecret: 'REPLACE_WITH_DIFFERENT_64_BYTE_HEX' },
        ],
        ['ENCRYPTION_SECRET', { encryptionKey: 'REPLACE_WITH_32_BYTE_HEX' }],
        // The built-in playback fallback: 38 characters, so the length check
        // alone used to let it through.
        [
            'PLAYBACK_TOKEN_SECRET',
            { playbackTokenSecret: 'dev-playback-secret-do-not-use-in-prod' },
        ],
        ['JWT_SECRET', { jwtSecret: `dev-${'x'.repeat(40)}` }],
    ])('refuses a placeholder %s', (name, overrides) => {
        expect(() => prod(overrides)).toThrow(name)
    })

    it.each([
        ['JWT_SECRET', { jwtSecret: undefined }],
        ['PLAYBACK_TOKEN_SECRET', { playbackTokenSecret: '' }],
        ['ENCRYPTION_SECRET', { encryptionKey: undefined }],
    ])('refuses a missing %s', (name, overrides) => {
        expect(() => prod(overrides)).toThrow(`${name} must be set`)
    })

    it('refuses a short signing secret', () => {
        expect(() => prod({ jwtSecret: 'short' })).toThrow('at least 32')
    })

    it('refuses one secret reused for both signers', () => {
        expect(() => prod({ playbackTokenSecret: STRONG_JWT })).toThrow(
            'distinct',
        )
    })
})
