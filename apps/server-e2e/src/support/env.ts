// Runs as a jest `setupFiles` entry, i.e. BEFORE the spec file is loaded and
// therefore before anything imports `environments/environment`, which reads
// every one of these at module scope and throws on a missing required value.
//
// These are deliberately not read from .env: the suite truncates every table
// between tests, and pointing it at the development database would wipe the
// club you were just clicking through in the browser.

const DEFAULT_TEST_DATABASE =
    'postgres://postgres:postgres@localhost:5432/clubspace_e2e?schema=public'

export const TEST_DATABASE_URL =
    process.env.E2E_DATABASE_URL ?? DEFAULT_TEST_DATABASE

const values: Record<string, string> = {
    NODE_ENV: 'test',
    PRODUCTION: '0',

    DATABASE_URL: TEST_DATABASE_URL,

    // A dedicated redis db so BullMQ queues from the suite never collide with
    // the jobs a locally running server has parked in db 0.
    REDIS_HOST: process.env.E2E_REDIS_HOST ?? 'localhost',
    REDIS_PORT: process.env.E2E_REDIS_PORT ?? '6379',
    REDIS_DB: '15',

    ROOT_URL: 'http://localhost:3000',
    JWT_ISSUER_URL: 'http://localhost:3000',
    JWT_AUDIENCE_URL: 'http://localhost:3000',
    // main.ts refuses to boot in production when these two match; keep them
    // distinct here too so the suite exercises the same shape as a real deploy.
    JWT_SECRET: 'e2e-jwt-secret-not-a-real-secret-long-enough',
    PLAYBACK_TOKEN_SECRET: 'e2e-playback-secret-not-a-real-secret-long-enough',
    ENCRYPTION_SECRET: 'e2e-encryption-secret-not-a-real-secret',

    SUPER_ADMIN_EMAIL: 'platform-owner@clubspace.test',

    // Parsed at boot into a nodemailer transport config. Nothing connects:
    // MailerService is replaced with a capturing stub in test-app.ts.
    SMTP_URL: 'smtp://user:pass@localhost:1025',
    SMTP_NO_REPLY_EMAIL: 'noreply@clubspace.test',

    CORS_ORIGINS: 'http://localhost:3000',

    S3_UPLOAD_BUCKET_URL: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET_NAME: 'e2e-bucket',
    S3_ACCESS_KEY_ID: 'e2e',
    S3_SECRET_ACCESS_KEY: 'e2e-secret',
    S3_FORCE_PATH_STYLE: 'true',
    S3_ACL: 'private',

    // The demo club is opt-in and stays off: specs create exactly the fixtures
    // they assert on, so a surprise seeded workspace would make counts wrong.
    SEED_DEMO_WORKSPACE: 'false',
}

for (const [key, value] of Object.entries(values)) {
    process.env[key] = value
}
