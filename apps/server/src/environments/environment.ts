import * as AWS from '@aws-sdk/client-s3'
import { get } from 'env-var'

import { WorkspaceType } from '../infrastructure/prisma/generated/client'
import { parseSmtpConnectionUrl } from '../shared/utils/parse-smtp-connection.util'
import { resolvePublicUrl } from '../shared/utils/public-urls'

// Single source of truth for "are we in production". Some deploys set
// PRODUCTION=1, some only NODE_ENV=production — treat either as prod so
// security gates can't end up half-on (e.g. prod seeding with dev secrets).
const isProduction =
    get('PRODUCTION').default('0').asBool() ||
    process.env.NODE_ENV === 'production'

export const environment = {
    production: isProduction,
    // The API host. Not a place people open in a browser — links in e-mails and
    // QR codes use adminUrl / appUrl below.
    rootUrl: get('ROOT_URL').required().asUrlString(),
    // Where the admin and the member web app live (links in e-mails, the QR
    // code). Explicit, or derived from an api.<domain> ROOT_URL in production.
    adminUrl: resolvePublicUrl({
        explicit: get('ADMIN_URL').required(false).asUrlString(),
        rootUrl: get('ROOT_URL').required().asUrlString(),
        subdomain: 'admin',
        devDefault: 'http://localhost:4200',
        production: isProduction,
    }),
    appUrl: resolvePublicUrl({
        explicit: get('APP_URL').required(false).asUrlString(),
        rootUrl: get('ROOT_URL').required().asUrlString(),
        subdomain: 'app',
        devDefault: 'http://localhost:8081',
        production: isProduction,
    }),
    // Optional store listings, shown as buttons in e-mails and on the poster.
    playStoreUrl: get('PLAY_STORE_URL').required(false).asUrlString(),
    ruStoreUrl: get('RUSTORE_URL').required(false).asUrlString(),
    databaseUrl: get('DATABASE_URL').required().asUrlString(),
    // The platform owner. First boot ensures an account with this address
    // exists and carries isSuperAdmin; changing it promotes a different
    // address on the next restart (existing platform admins are left alone).
    // Required in production: the old default was a real, registrable domain,
    // so a deploy that forgot it handed the platform to whoever owned it.
    adminEmail:
        process.env.NODE_ENV === 'production' ||
        get('PRODUCTION').default('0').asBool()
            ? get('SUPER_ADMIN_EMAIL').required().asEmailString()
            : get('SUPER_ADMIN_EMAIL')
                  .default('superadmin@localhost.invalid')
                  .asEmailString(),
    // Read only so a stale SUPER_ADMIN_PASSWORD in someone's .env doesn't blow
    // up env-var parsing. Nothing authenticates with it: sign-in compares the
    // emailed OTP against User.completeCode and never reads User.password.
    adminPassword: get('SUPER_ADMIN_PASSWORD').required(false).asString(),
    // Opt-in "store review account": one email that signs in with a fixed
    // code, so Google Play / App Store reviewers (who can't read our mail) can
    // log in. Both or neither; validated at boot by resolveStoreReview.
    storeReview: {
        // asString, not asEmailString: an empty `STORE_REVIEW_EMAIL=` must mean
        // "unset", and mixed case is fine. resolveStoreReview validates it.
        email: get('STORE_REVIEW_EMAIL').required(false).asString(),
        code: get('STORE_REVIEW_CODE').required(false).asString(),
    },
    encryptionKey: get('ENCRYPTION_SECRET').required().asString(),
    jwt: {
        issuerUrl: get('JWT_ISSUER_URL').required().asUrlString(),
        audienceUrl: get('JWT_AUDIENCE_URL').required().asUrlString(),
        accessTokenTTL: get('JWT_ACCESS_TOKEN_TTL')
            .default(15 * 60)
            .asInt(),
        refreshTokenTTL: get('JWT_REFRESH_TOKEN_TTL')
            .default(60 * 60)
            .asInt(),
        secret: get('JWT_SECRET').required().asString(),
    },
    // HMAC secret used to sign short-lived HLS playback tokens. MUST be
    // distinct from JWT_SECRET so compromising one does not compromise the
    // other. In production it is required; in dev we fall back to a
    // well-known string so local dev keeps working.
    playbackTokenSecret:
        process.env.NODE_ENV === 'production'
            ? get('PLAYBACK_TOKEN_SECRET').required().asString()
            : get('PLAYBACK_TOKEN_SECRET')
                  .default('dev-playback-secret-do-not-use-in-prod')
                  .asString(),
    notifications: {
        transport: {
            // nodemailer waits 2 minutes per stage by default; with retries a
            // dead relay took ~6 minutes to register as down. Query params in
            // SMTP_URL still override these.
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
            ...parseSmtpConnectionUrl(get('SMTP_URL').required().asUrlString()),
        },
        defaults: {
            from: get('SMTP_NO_REPLY_EMAIL').required().asString(),
        },
    },
    s3Storage: {
        s3UploadBucketUrl: get('S3_UPLOAD_BUCKET_URL').required().asUrlString(),
        s3Region: get('S3_REGION').required().asString(),
        s3BucketName: get('S3_BUCKET_NAME').required().asString(),
        s3AccessKeyId: get('S3_ACCESS_KEY_ID').required().asString(),
        s3SecretAccessKey: get('S3_SECRET_ACCESS_KEY').required().asString(),
        s3ForcePathStyle: get('S3_FORCE_PATH_STYLE').default('true').asBool(),
        s3AccelerateUrl: get('S3_ACCELERATE_URL').required(false).asString(),
        // Largest single video upload. Uploads go straight from the browser to
        // storage, so without a cap one stray 4K export can fill a home
        // server's disk — and Postgres shares that disk.
        maxVideoUploadMb: get('MAX_VIDEO_UPLOAD_MB').default('10240').asIntPositive(),
        s3Acl: get('S3_ACL')
            .required()
            .asEnum(Object.values(AWS.ObjectCannedACL)),
    },
    redis: {
        host: get('REDIS_HOST').default('localhost').asString(),
        port: get('REDIS_PORT').default(6379).asInt(),
        password: get('REDIS_PASSWORD').required(false).asString(),
        db: get('REDIS_DB').default(0).asInt(),
    },
    // Opt-in sample club for local development (grappling categories, belt
    // tags, demo plans). OFF by default: real clubs are created from the
    // platform console, and a fresh deploy should not invent one — least of
    // all a grappling-shaped one on a yoga or fitness install.
    seedDemoWorkspace: get('SEED_DEMO_WORKSPACE').default('false').asBool(),
    defaultWorkspaceKey: get('DEFAULT_WORKSPACE_KEY').default('bjj-academy').asString(),
    defaultWorkspaceName: get('DEFAULT_WORKSPACE_NAME').default('BJJ Academy').asString(),
    defaultWorkspaceType: get('DEFAULT_WORKSPACE_TYPE').default(WorkspaceType.GRAPPLING).asEnum(Object.values(WorkspaceType) as string[]),
    defaultWorkspaceAdminEmail: get('DEFAULT_WORKSPACE_ADMIN_EMAIL').default('admin@bjj-academy.com').asEmailString(),
    // No default: required in production (enforced in setupDefaultWorkspace) so
    // the seeded workspace admin never ships with a hardcoded password.
    defaultWorkspaceAdminPassword: get('DEFAULT_WORKSPACE_ADMIN_PASSWORD').required(false).asString(),
    // Resend cooldown for OTP codes, in milliseconds. 60_000 = 1 min.
    completeCodeTimeout: get('COMPLETE_CODE_TIMEOUT').default(60_000).asInt(),
    sentry: {
        dsn: get('SENTRY_DSN').required(false).asString(),
        environment: get('SENTRY_ENVIRONMENT').default('development').asString(),
        tracesSampleRate: get('SENTRY_TRACES_SAMPLE_RATE')
            .default('0')
            .asFloat(),
    },
}
