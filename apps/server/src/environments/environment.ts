import * as AWS from '@aws-sdk/client-s3'
import { get } from 'env-var'

import { WorkspaceType } from '../infrastructure/prisma/generated/client'
import { parseSmtpConnectionUrl } from '../shared/utils/parse-smtp-connection.util'

export const environment = {
    production: get('PRODUCTION').default('0').asBool(),
    rootUrl: get('ROOT_URL').required().asUrlString(),
    databaseUrl: get('DATABASE_URL').required().asUrlString(),
    adminEmail: get('SUPER_ADMIN_EMAIL').default('admin@super.com').asEmailString(),
    // No default: an unset password must be falsy so the production guard in
    // setupSystemUser can fail fast instead of silently seeding a super admin
    // with a well-known password. Dev supplies it via .env.
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
