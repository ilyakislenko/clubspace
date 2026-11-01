import * as AWS from '@aws-sdk/client-s3'
import { Logger } from '@nestjs/common'
import { get } from 'env-var'

import {
    missingSellerRequisites,
    parseLegalVersion,
    type SellerRequisites,
} from '../domains/billing/club-legal'
import { resolvePlatformPricing } from '../domains/billing/platform-pricing.config'
import { parseTrialReminderDays } from '../domains/billing/trial-limits'
import { parseSmtpConnectionUrl } from '../shared/utils/parse-smtp-connection.util'
import { resolvePublicUrl } from '../shared/utils/public-urls'

// Single source of truth for "are we in production". Some deploys set
// PRODUCTION=1, some only NODE_ENV=production — treat either as prod so
// security gates can't end up half-on (e.g. prod seeding with dev secrets).
const isProduction =
    get('PRODUCTION').default('0').asBool() ||
    process.env.NODE_ENV === 'production'

// A missing public address must not stop the API from booting: it only costs
// the links people open (join link, QR, buttons in e-mails).
const publicUrlOrWarn = (
    name: 'ADMIN_URL' | 'APP_URL',
    resolved: string | null,
): string | null => {
    if (!resolved) {
        new Logger('Environment').warn(
            `${name} is not set and cannot be derived from ROOT_URL (not an api.<domain> address): links to it are omitted`,
        )
    }
    return resolved
}

// Videos are uploaded in one presigned PUT, and S3 refuses a single PUT above
// 5 GiB. A higher limit would let a coach pick a file that is accepted here and
// then fails at storage after the whole upload — so refuse to boot instead.
const SINGLE_PUT_MAX_MB = 5120

const requireSinglePutLimit = (mb: number): number => {
    if (mb > SINGLE_PUT_MAX_MB) {
        throw new Error(
            `MAX_VIDEO_UPLOAD_MB=${mb} exceeds ${SINGLE_PUT_MAX_MB}: videos are uploaded in one presigned PUT, and S3 refuses a single PUT above 5 GiB. Set MAX_VIDEO_UPLOAD_MB=${SINGLE_PUT_MAX_MB} or lower.`,
        )
    }
    return mb
}

// Card billing of clubs without the seller's requisites would take money
// under an offer naming nobody: production keeps it off
// (platformGatewayCredentials) and says so at boot — never a crash, the rest
// of the platform works.
const sellerRequisitesOrWarn = (seller: SellerRequisites): SellerRequisites => {
    const missing = missingSellerRequisites(seller)
    if (
        isProduction &&
        missing.length > 0 &&
        get('PLATFORM_BILLING_ENABLED').default('true').asBool()
    ) {
        new Logger('Environment').warn(
            `Seller requisites are incomplete (missing: ${missing.join(', ')} — PLATFORM_SELLER_*): card payments and autopay of clubs stay off until they are set; /legal/* shows «заполняется»`,
        )
    }
    return seller
}

export const environment = {
    production: isProduction,
    // The API host. Not a place people open in a browser — links in e-mails and
    // QR codes use adminUrl / appUrl below.
    rootUrl: get('ROOT_URL').required().asUrlString(),
    // Where the admin and the member web app live (links in e-mails, the QR
    // code). Explicit, or derived from an api.<domain> ROOT_URL in production.
    // null when neither is possible — callers omit the links then.
    adminUrl: publicUrlOrWarn(
        'ADMIN_URL',
        resolvePublicUrl({
            explicit: get('ADMIN_URL').required(false).asUrlString(),
            rootUrl: get('ROOT_URL').required().asUrlString(),
            subdomain: 'admin',
            devDefault: 'http://localhost:4200',
            production: isProduction,
        }),
    ),
    appUrl: publicUrlOrWarn(
        'APP_URL',
        resolvePublicUrl({
            explicit: get('APP_URL').required(false).asUrlString(),
            rootUrl: get('ROOT_URL').required().asUrlString(),
            subdomain: 'app',
            devDefault: 'http://localhost:8081',
            production: isProduction,
        }),
    ),
    // Optional store listings, shown as buttons in e-mails and on the poster.
    // asString + `|| undefined`: an empty `PLAY_STORE_URL=` in .env means unset.
    playStoreUrl: get('PLAY_STORE_URL').required(false).asString() || undefined,
    ruStoreUrl: get('RUSTORE_URL').required(false).asString() || undefined,
    appStoreUrl: get('APP_STORE_URL').required(false).asString() || undefined,
    databaseUrl: get('DATABASE_URL').required().asUrlString(),
    // Connections per process. Total across pods (API replicas × this, plus
    // workers) must stay under Postgres max_connections / the pooler's limit.
    databasePoolMax: get('DATABASE_POOL_MAX').default(10).asIntPositive(),
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
    // workspaceKey names the demo club the reviewer is made an ACTIVE student
    // of on every review sign-in, so the review sees real content.
    storeReview: {
        // asString, not asEmailString: an empty `STORE_REVIEW_EMAIL=` must mean
        // "unset", and mixed case is fine. resolveStoreReview validates it.
        email: get('STORE_REVIEW_EMAIL').required(false).asString(),
        code: get('STORE_REVIEW_CODE').required(false).asString(),
        workspaceKey: get('STORE_REVIEW_WORKSPACE_KEY')
            .required(false)
            .asString(),
    } as { email?: string; code?: string; workspaceKey?: string },
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
    // other. Required in production (by either production flag — keying this
    // on NODE_ENV alone let PRODUCTION=1 boot on the dev default); in dev we
    // fall back to a well-known string so local dev keeps working.
    playbackTokenSecret: isProduction
        ? get('PLAYBACK_TOKEN_SECRET').required().asString()
        : get('PLAYBACK_TOKEN_SECRET')
              .default('dev-playback-secret-do-not-use-in-prod')
              .asString(),
    // The Scalar API reference at /api. On by default in development, off in
    // production unless explicitly enabled.
    apiDocsEnabled: get('API_DOCS_ENABLED')
        .default(isProduction ? 'false' : 'true')
        .asBool(),
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
        // The PUBLIC storage origin: presigned upload and segment URLs are
        // signed for it, and browsers and phones fetch them there.
        s3UploadBucketUrl: get('S3_UPLOAD_BUCKET_URL').required().asUrlString(),
        // Where the server itself talks to storage (deletes, listings, reads),
        // when that differs from the public origin — http://minio:9000 inside
        // the compose network, so the public endpoint only has to accept what
        // browsers send. Empty means unset: everything uses the public origin.
        s3InternalUrl: get('S3_INTERNAL_URL').required(false).asString() || undefined,
        s3Region: get('S3_REGION').required().asString(),
        s3BucketName: get('S3_BUCKET_NAME').required().asString(),
        s3AccessKeyId: get('S3_ACCESS_KEY_ID').required().asString(),
        s3SecretAccessKey: get('S3_SECRET_ACCESS_KEY').required().asString(),
        s3ForcePathStyle: get('S3_FORCE_PATH_STYLE').default('true').asBool(),
        s3AccelerateUrl: get('S3_ACCELERATE_URL').required(false).asString(),
        // Largest single video upload. Uploads go straight from the browser to
        // storage, so without a cap one stray 4K export can fill a home
        // server's disk — and Postgres shares that disk. Capped at a single
        // S3 PUT, which is how the browser uploads.
        maxVideoUploadMb: requireSinglePutLimit(
            get('MAX_VIDEO_UPLOAD_MB')
                .default(String(SINGLE_PUT_MAX_MB))
                .asIntPositive(),
        ),
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
    // Opt-in demo club («ACADEMY», generated by
    // domains/demo) created at boot when missing. OFF by default: real clubs
    // are created from the platform console, and a fresh deploy should not
    // invent one.
    seedDemoWorkspace: get('SEED_DEMO_WORKSPACE').default('false').asBool(),
    // In-person demo kit (docs/demo.md): fixed-code sign-in for the demo
    // accounts and the «Сбросить демо» reset. Validated at boot by
    // resolveDemoMode — DEMO_WORKSPACE_KEY must name the demo club and the
    // code must be 6 non-trivial digits, or the server refuses to start.
    demo: {
        enabled: get('DEMO_MODE').default('false').asBool(),
        workspaceKey: get('DEMO_WORKSPACE_KEY').required(false).asString(),
        code: get('DEMO_LOGIN_CODE').required(false).asString(),
    } as { enabled: boolean; workspaceKey?: string; code?: string },
    // Resend cooldown for OTP codes, in milliseconds. 60_000 = 1 min.
    completeCodeTimeout: get('COMPLETE_CODE_TIMEOUT').default(60_000).asInt(),
    // Nightly purge: in-app notifications older than this many days are deleted.
    notificationRetentionDays: get('NOTIFICATION_RETENTION_DAYS').default('90').asIntPositive(),
    // Current edition of the personal-data consent text (apps/client
    // /legal/consent). Bump it when the text changes: every account whose
    // accepted version differs is gated by AuthGuard until it accepts again.
    consent: {
        personalDataVersion: get('CONSENT_VERSION')
            .default('2026-11-01')
            .asString(),
    },
    // ИИ-ассистент over MCP (docs/mcp.md): calls per token per minute. Every
    // request to /mcp counts (initialize, tools/list, tools/call, ping).
    ai: {
        mcpRateLimitPerMinute: get('AI_MCP_RATE_LIMIT_PER_MINUTE')
            .default('60')
            .asIntPositive(),
        // «ИИ-ассистент» chat in the admin (features/ai-chat): any
        // OpenAI-compatible chat-completions API with streaming and tool
        // calls, OpenRouter by default. Without a key the chat says
        // «не настроено» and nothing leaves the server.
        chat: {
            baseUrl: get('AI_CHAT_BASE_URL')
                .default('https://openrouter.ai/api/v1')
                .asString(),
            apiKey: get('AI_CHAT_API_KEY').required(false).asString(),
            model: get('AI_CHAT_MODEL').default('openai/gpt-4.1-mini').asString(),
            // Questions per club per calendar month (club time); a club on
            // its unpaid trial gets the smaller allowance.
            monthlyQuestions: get('AI_CHAT_MONTHLY_QUESTIONS')
                .default('300')
                .asIntPositive(),
            trialMonthlyQuestions: get('AI_CHAT_TRIAL_MONTHLY_QUESTIONS')
                .default('30')
                .asIntPositive(),
        },
    },
    sentry: {
        dsn: get('SENTRY_DSN').required(false).asString(),
        environment: get('SENTRY_ENVIRONMENT').default('development').asString(),
        tracesSampleRate: get('SENTRY_TRACES_SAMPLE_RATE')
            .default('0')
            .asFloat(),
    },
    // Web Push for the PWA / browser build (RFC 8030 + VAPID, RFC 8292).
    // Generate a pair with `node apps/server/scripts/generate-vapid-keys.mjs`.
    // Unset → the browser build offers no notifications; native Expo push is
    // unaffected. The subject is a mailto: or https: contact for push services.
    webPush: {
        publicKey: get('WEB_PUSH_VAPID_PUBLIC_KEY').required(false).asString() || null,
        privateKey: get('WEB_PUSH_VAPID_PRIVATE_KEY').required(false).asString() || null,
        subject: get('WEB_PUSH_SUBJECT').default('mailto:support@clubspace.app').asString(),
    },
    // SaaS side: what clubs pay ClubSpace. `enabled: false` is a self-hosted
    // install — every module on, no trial expiry, no billing nags in the admin.
    // Collection: card payments and autopay through the platform's own
    // YooKassa shop (`yookassa` below); without it, only the console's manual
    // «отметить оплату».
    billing: {
        enabled: get('PLATFORM_BILLING_ENABLED').default('true').asBool(),
        // The public «create your club» wizard at <admin>/sign-up. Off by
        // default: clubs are otherwise created from the platform console.
        selfServeSignupEnabled: get('SELF_SERVE_SIGNUP_ENABLED')
            .default('false')
            .asBool(),
        // Every new club starts on a trial with all modules on.
        trialDays: get('PLATFORM_TRIAL_DAYS').default(30).asIntPositive(),
        // Days a club stays usable after its trial or paid period ran out.
        graceDays: get('PLATFORM_GRACE_DAYS').default(7).asIntPositive(),
        // A club suspended this long (and still unpaid) is archived: hidden
        // from members and the public listing, its data kept.
        archiveAfterDays: get('PLATFORM_ARCHIVE_AFTER_DAYS').default(30).asIntPositive(),
        // What a trial may cost ClubSpace (domains/billing/trial-limits.ts):
        // VIDEO storage and monthly viewing caps, the e-mails a club may send
        // to people, and the trial days the owner is reminded on.
        trial: {
            videoStorageGb: get('PLATFORM_TRIAL_VIDEO_STORAGE_GB').default(2).asIntPositive(),
            videoViewHoursPerMonth: get('PLATFORM_TRIAL_VIDEO_VIEW_HOURS')
                .default(10)
                .asIntPositive(),
            emails: get('PLATFORM_TRIAL_EMAIL_LIMIT').default(100).asIntPositive(),
            reminderDays: parseTrialReminderDays(
                get('PLATFORM_TRIAL_REMINDER_DAYS').default('23,28').asString(),
                get('PLATFORM_TRIAL_DAYS').default(30).asIntPositive(),
            ),
        },
        // «Пробный период с картой»: the default for clubs the console did not
        // set; the card is bound with a CARD_CHECK payment of checkAmount
        // rubles, refunded at once (YooKassa saves a card only with a payment).
        cardTrial: {
            enabled: get('PLATFORM_CARD_TRIAL_ENABLED').default('false').asBool(),
            checkAmount: get('PLATFORM_CARD_CHECK_AMOUNT').default(1).asIntPositive(),
        },
        // The console's «стоимость пробного периода»: rubles per GB stored a
        // month, per hour watched, per e-mail, per active member a month.
        trialCostRates: {
            storageGbMonth: get('PLATFORM_COST_STORAGE_GB_MONTH').default(3).asFloatPositive(),
            viewHour: get('PLATFORM_COST_VIEW_HOUR').default(2).asFloatPositive(),
            email: get('PLATFORM_COST_EMAIL').default(0.1).asFloatPositive(),
            activeMemberMonth: get('PLATFORM_COST_ACTIVE_MEMBER_MONTH')
                .default(1)
                .asFloatPositive(),
        },
        // Active-member tiers, paid modules, annual discount and setup fee —
        // see platform-pricing.config.ts for the defaults and the JSON shape.
        pricing: resolvePlatformPricing({
            plans: get('PLATFORM_PLANS').required(false).asString(),
            modules: get('PLATFORM_MODULES').required(false).asString(),
            annualDiscountPercent: get('PLATFORM_ANNUAL_DISCOUNT_PERCENT')
                .default(15)
                .asIntPositive(),
            setupFee: get('PLATFORM_SETUP_FEE').default(4990).asIntPositive(),
        }),
        // The platform's own YooKassa shop (not a club's). Both set = clubs pay
        // by card on the «Тариф» page and renewals are charged automatically;
        // either missing = the feature is off. Webhook URL to register in the
        // shop: <ROOT_URL>/payments/webhooks/platform/yookassa (deploy/README.md).
        yookassa: {
            shopId: get('PLATFORM_YOOKASSA_SHOP_ID').required(false).asString(),
            secretKey: get('PLATFORM_YOOKASSA_SECRET_KEY')
                .required(false)
                .asString(),
            // 54-ФЗ receipt: YooKassa vat_code (1 = без НДС … 11 = 22%) and,
            // for a shop with several tax systems, tax_system_code (1–6).
            receiptEnabled: get('PLATFORM_RECEIPT_ENABLED')
                .default('true')
                .asBool(),
            vatCode: get('PLATFORM_RECEIPT_VAT_CODE').default(1).asIntPositive(),
            taxSystemCode: get('PLATFORM_RECEIPT_TAX_SYSTEM_CODE')
                .required(false)
                .asIntPositive(),
        },
        // The platform's contract with clubs (domains/billing/club-legal.ts,
        // docs/legal/README.md). Editions are named by their effective date;
        // bump one when its text in apps/client changes: every club owner
        // gets a banner and acceptGraceDays to accept, then paid actions are
        // refused until they do. Seller requisites render on /legal/* as
        // «заполняется» until set; production keeps card billing off without
        // the required ones.
        legal: {
            offerVersion: parseLegalVersion(
                get('PLATFORM_OFFER_VERSION').default('2026-11-01').asString(),
                'PLATFORM_OFFER_VERSION',
            ),
            dpaVersion: parseLegalVersion(
                get('PLATFORM_DPA_VERSION').default('2026-11-01').asString(),
                'PLATFORM_DPA_VERSION',
            ),
            acceptGraceDays: get('PLATFORM_LEGAL_ACCEPT_GRACE_DAYS')
                .default(14)
                .asIntPositive(),
            seller: sellerRequisitesOrWarn({
                name: get('PLATFORM_SELLER_NAME').default('').asString(),
                inn: get('PLATFORM_SELLER_INN').default('').asString(),
                ogrnip: get('PLATFORM_SELLER_OGRNIP').default('').asString(),
                address: get('PLATFORM_SELLER_ADDRESS').default('').asString(),
                bankName: get('PLATFORM_SELLER_BANK_NAME').default('').asString(),
                bik: get('PLATFORM_SELLER_BIK').default('').asString(),
                account: get('PLATFORM_SELLER_ACCOUNT').default('').asString(),
                corrAccount: get('PLATFORM_SELLER_CORR_ACCOUNT').default('').asString(),
                email: get('PLATFORM_SELLER_EMAIL').default('').asString(),
                phone: get('PLATFORM_SELLER_PHONE').default('').asString(),
            }),
        },
    },
}
