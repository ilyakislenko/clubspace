// Loads the real environment module against a controlled process.env: the
// public addresses must never stop the API from booting, and an empty store
// URL means "unset".
const REQUIRED: Record<string, string> = {
    ROOT_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SUPER_ADMIN_EMAIL: 'root@example.com',
    ENCRYPTION_SECRET: 'x',
    JWT_ISSUER_URL: 'http://localhost:3000',
    JWT_AUDIENCE_URL: 'http://localhost:3000',
    JWT_SECRET: 'x',
    SMTP_URL: 'smtp://localhost:1025',
    SMTP_NO_REPLY_EMAIL: 'no-reply@example.com',
    S3_UPLOAD_BUCKET_URL: 'http://localhost:9000',
    S3_REGION: 'r',
    S3_BUCKET_NAME: 'b',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
    S3_ACL: 'private',
}

const loadEnvironment = (extra: Record<string, string>) => {
    const saved = { ...process.env }
    for (const k of [
        'ADMIN_URL',
        'APP_URL',
        'PLAY_STORE_URL',
        'RUSTORE_URL',
        'PRODUCTION',
    ]) {
        delete process.env[k]
    }
    Object.assign(process.env, REQUIRED, extra)
    try {
        let loaded!: typeof import('./environment')
        jest.isolateModules(() => {
            loaded = require('./environment')
        })
        return loaded.environment
    } finally {
        process.env = saved
    }
}

describe('environment public addresses', () => {
    it('boots in production with null addresses when they cannot be derived', () => {
        const env = loadEnvironment({
            PRODUCTION: '1',
            ROOT_URL: 'https://club.example',
        })
        expect(env.appUrl).toBeNull()
        expect(env.adminUrl).toBeNull()
    })

    it('derives them from an api.<domain> ROOT_URL in production', () => {
        const env = loadEnvironment({
            PRODUCTION: '1',
            ROOT_URL: 'https://api.club.example',
        })
        expect(env.appUrl).toBe('https://app.club.example')
        expect(env.adminUrl).toBe('https://admin.club.example')
    })

    it('treats empty store URLs as unset and keeps real ones', () => {
        const empty = loadEnvironment({ PLAY_STORE_URL: '', RUSTORE_URL: '' })
        expect(empty.playStoreUrl).toBeUndefined()
        expect(empty.ruStoreUrl).toBeUndefined()

        const set = loadEnvironment({
            PLAY_STORE_URL: 'https://play.google.com/x',
        })
        expect(set.playStoreUrl).toBe('https://play.google.com/x')
    })
})
