import envVar from 'env-var'

const { get } = envVar

const requireAtLeast = (name: string, value: number, min: number): number => {
    if (value < min) {
        throw new Error(
            `${name}=${value} is below the ${min}ms floor — did you write seconds?`,
        )
    }
    return value
}

// Uploads are one presigned PUT, and S3 refuses a single PUT above 5 GiB.
// Same check as the server, so a misconfigured install stops at boot in both.
const SINGLE_PUT_MAX_MB = 5120

const requireSinglePutLimit = (mb: number): number => {
    if (mb > SINGLE_PUT_MAX_MB) {
        throw new Error(
            `MAX_VIDEO_UPLOAD_MB=${mb} exceeds ${SINGLE_PUT_MAX_MB}: videos are uploaded in one presigned PUT, and S3 refuses a single PUT above 5 GiB. Set MAX_VIDEO_UPLOAD_MB=${SINGLE_PUT_MAX_MB} or lower.`,
        )
    }
    return mb
}

export const environment = {
    databaseUrl: get('DATABASE_URL').required().asUrlString(),
    // Hard ceiling on one ffmpeg run. A transcode that never finishes is not
    // one broken video — it holds one of TRANSCODE_CONCURRENCY slots for good,
    // and at the default of 1 that is the whole queue stopped. BullMQ will not
    // intervene: the job is not stalled, its lock keeps renewing because
    // ffmpeg runs in a child process and the event loop stays free.
    // Floored, because the failure is asymmetric: too high wastes one queue
    // slot for a while, too low SIGKILLs healthy encodes — and since a timeout
    // is unrecoverable, marks every video permanently failed with no retry.
    // Someone writing seconds instead of milliseconds should hear about it at
    // boot, not through a day of dead uploads.
    transcodeTimeoutMs: requireAtLeast(
        'VIDEO_TRANSCODE_TIMEOUT_MS',
        get('VIDEO_TRANSCODE_TIMEOUT_MS')
            .default(30 * 60 * 1000)
            .asIntPositive(),
        60_000,
    ),
    // Parallel transcodes per worker process. Each one is a full ffmpeg
    // encoding two renditions, so raise it only with spare cores and RAM.
    concurrency: get('TRANSCODE_CONCURRENCY').default(1).asIntPositive(),
    // Same variable as the server: the server refuses larger uploads up front,
    // the worker re-checks the stored object before downloading it.
    maxInputBytes:
        requireSinglePutLimit(
            get('MAX_VIDEO_UPLOAD_MB').default(SINGLE_PUT_MAX_MB).asIntPositive(),
        ) *
        1024 *
        1024,
    // Longer sources are refused before encoding: the transcode timeout would
    // kill them anyway, only after holding a slot for the full timeout.
    maxDurationSec:
        get('MAX_VIDEO_DURATION_MINUTES').default(240).asIntPositive() * 60,
    // `|| …`: an empty `FFMPEG_PATH=` in .env means unset, not "run ''".
    ffmpegPath: get('FFMPEG_PATH').required(false).asString() || undefined,
    ffprobePath: get('FFPROBE_PATH').required(false).asString() || 'ffprobe',
    sentry: {
        dsn: get('SENTRY_DSN').required(false).asString(),
        environment: get('SENTRY_ENVIRONMENT').default('development').asString(),
    },
    redis: {
        host: get('REDIS_HOST').default('localhost').asString(),
        port: get('REDIS_PORT').default(6379).asInt(),
        password: get('REDIS_PASSWORD').required(false).asString(),
        db: get('REDIS_DB').default(0).asInt(),
    },
    s3Storage: {
        s3UploadBucketUrl: get('S3_UPLOAD_BUCKET_URL').required().asUrlString(),
        // Where the worker itself talks to storage, when that differs from the
        // public URL (http://minio:9000 inside the compose network). Empty
        // means unset.
        s3InternalUrl: get('S3_INTERNAL_URL').required(false).asString() || undefined,
        s3Region: get('S3_REGION').required().asString(),
        s3BucketName: get('S3_BUCKET_NAME').required().asString(),
        s3AccessKeyId: get('S3_ACCESS_KEY_ID').required().asString(),
        s3SecretAccessKey: get('S3_SECRET_ACCESS_KEY').required().asString(),
        s3ForcePathStyle: get('S3_FORCE_PATH_STYLE').default('true').asBool(),
        s3AccelerateUrl: get('S3_ACCELERATE_URL').required(false).asString(),
    },
}
