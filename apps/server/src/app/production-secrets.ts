// Fail fast in production if a signing or encryption secret is missing, weak,
// or still a value nobody chose: a placeholder copied from
// .env.production.example (REPLACE_WITH_…) or a development default (dev-…).
// Such a value is public, so the server would accept forged access tokens or
// playback URLs — crashing the container is the better outcome.

const MIN_LENGTH = 32

// Matches the example-file placeholders and every built-in development
// default (e.g. the playback secret's dev fallback). Real generated secrets
// (hex from `openssl rand`) never contain either.
const PLACEHOLDER = /REPLACE_WITH|dev-/i

export type ProductionSecretsConfig = {
    production: boolean
    jwtSecret: string | undefined
    playbackTokenSecret: string | undefined
    encryptionKey: string | undefined
}

export const assertProductionSecrets = (
    config: ProductionSecretsConfig,
): void => {
    if (!config.production) return

    const signing: Array<[string, string | undefined]> = [
        ['JWT_SECRET', config.jwtSecret],
        ['PLAYBACK_TOKEN_SECRET', config.playbackTokenSecret],
    ]
    const all: Array<[string, string | undefined]> = [
        ...signing,
        ['ENCRYPTION_SECRET', config.encryptionKey],
    ]

    for (const [name, value] of all) {
        if (!value) {
            throw new Error(`[startup] ${name} must be set in production`)
        }
        if (PLACEHOLDER.test(value)) {
            throw new Error(
                `[startup] ${name} is a placeholder or development value — generate a real secret for production`,
            )
        }
    }

    for (const [name, value] of signing) {
        if (value && value.length < MIN_LENGTH) {
            throw new Error(
                `[startup] ${name} must be at least ${MIN_LENGTH} characters in production (got ${value.length})`,
            )
        }
    }

    if (config.jwtSecret === config.playbackTokenSecret) {
        throw new Error(
            '[startup] JWT_SECRET and PLAYBACK_TOKEN_SECRET must be distinct values',
        )
    }
}
