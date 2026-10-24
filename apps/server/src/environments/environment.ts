import * as AWS from '@aws-sdk/client-s3'
import { get } from 'env-var'

import { WorkspaceType } from '../infrastructure/prisma/generated/client'
import { parseSmtpConnectionUrl } from '../shared/utils/parse-smtp-connection.util'

export const environment = {
    // Single source of truth for "are we in production". Some deploys set
    // PRODUCTION=1, some only NODE_ENV=production — treat either as prod so
    // security gates can't end up half-on (e.g. prod seeding with dev secrets).
    production:
        get('PRODUCTION').default('0').asBool() ||
        process.env.NODE_ENV === 'production',
    rootUrl: get('ROOT_URL').required().asUrlString(),
    databaseUrl: get('DATABASE_URL').required().asUrlString(),
    // The platform owner. First boot ensures an account with this address
    // exists and carries isSuperAdmin; changing it promotes a different
    // address on the next restart (existing platform admins are left alone).
    adminEmail: get('SUPER_ADMIN_EMAIL').default('admin@super.com').asEmailString(),
    // Read only so a stale SUPER_ADMIN_PASSWORD in someone's .env doesn't blow
    // up env-var parsing. Nothing authenticates with it: sign-in compares the
    // emailed OTP against User.completeCode and never reads User.password.
    adminPassword: get('SUPER_ADMIN_PASSWORD').required(false).asString(),
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
        transport: parseSmtpConnectionUrl(
            get('SMTP_URL').required().asUrlString(),
        ),
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
