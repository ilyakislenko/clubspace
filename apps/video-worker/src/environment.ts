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

export const environment = {
    databaseUrl: get('DATABASE_URL').required().asUrlString(),
    // Hard ceiling on one ffmpeg run. Concurrency is 1, so a transcode that
    // never finishes is not one broken video — it is the whole queue stopped
    // for good. BullMQ will not intervene: the job is not stalled, its lock
    // keeps renewing because ffmpeg runs in a child process and the event
    // loop stays free.
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
    redis: {
        host: get('REDIS_HOST').default('localhost').asString(),
        port: get('REDIS_PORT').default(6379).asInt(),
        password: get('REDIS_PASSWORD').required(false).asString(),
        db: get('REDIS_DB').default(0).asInt(),
    },
    s3Storage: {
        s3UploadBucketUrl: get('S3_UPLOAD_BUCKET_URL').required().asUrlString(),
        s3Region: get('S3_REGION').required().asString(),
        s3BucketName: get('S3_BUCKET_NAME').required().asString(),
        s3AccessKeyId: get('S3_ACCESS_KEY_ID').required().asString(),
        s3SecretAccessKey: get('S3_SECRET_ACCESS_KEY').required().asString(),
        s3ForcePathStyle: get('S3_FORCE_PATH_STYLE').default('true').asBool(),
        s3AccelerateUrl: get('S3_ACCELERATE_URL').required(false).asString(),
    },
}
