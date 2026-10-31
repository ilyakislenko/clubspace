import type { environment } from './environment'

// Loads the real environment module against a controlled process.env.
const REQUIRED: Record<string, string> = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    S3_UPLOAD_BUCKET_URL: 'http://localhost:9000',
    S3_REGION: 'r',
    S3_BUCKET_NAME: 'b',
    S3_ACCESS_KEY_ID: 'k',
    S3_SECRET_ACCESS_KEY: 's',
}

const OPTIONAL = [
    'MAX_VIDEO_UPLOAD_MB',
    'MAX_VIDEO_DURATION_MINUTES',
    'TRANSCODE_CONCURRENCY',
    'VIDEO_TRANSCODE_TIMEOUT_MS',
    'S3_INTERNAL_URL',
    'SENTRY_DSN',
    'FFMPEG_PATH',
    'FFPROBE_PATH',
]

const loadEnvironment = (extra: Record<string, string> = {}) => {
    const saved = { ...process.env }
    for (const k of OPTIONAL) delete process.env[k]
    Object.assign(process.env, REQUIRED, extra)
    try {
        let loaded!: { environment: typeof environment }
        jest.isolateModules(() => {
            loaded = require('./environment')
        })
        return loaded.environment
    } finally {
        process.env = saved
    }
}

describe('video-worker environment', () => {
    it('defaults to one transcode at a time, 5 GiB and 4 hours', () => {
        const env = loadEnvironment()
        expect(env.concurrency).toBe(1)
        expect(env.maxInputBytes).toBe(5120 * 1024 * 1024)
        expect(env.maxDurationSec).toBe(4 * 60 * 60)
        expect(env.s3Storage.s3InternalUrl).toBeUndefined()
    })

    it('reads the configured limits', () => {
        const env = loadEnvironment({
            TRANSCODE_CONCURRENCY: '3',
            MAX_VIDEO_UPLOAD_MB: '2048',
            MAX_VIDEO_DURATION_MINUTES: '90',
            S3_INTERNAL_URL: 'http://minio:9000',
        })
        expect(env.concurrency).toBe(3)
        expect(env.maxInputBytes).toBe(2048 * 1024 * 1024)
        expect(env.maxDurationSec).toBe(90 * 60)
        expect(env.s3Storage.s3InternalUrl).toBe('http://minio:9000')
    })

    it('treats empty S3_INTERNAL_URL and binary paths as unset', () => {
        const env = loadEnvironment({ S3_INTERNAL_URL: '', FFMPEG_PATH: '', FFPROBE_PATH: '' })
        expect(env.s3Storage.s3InternalUrl).toBeUndefined()
        expect(env.ffmpegPath).toBeUndefined()
        expect(env.ffprobePath).toBe('ffprobe')
    })

    it('reads explicit binary paths', () => {
        const env = loadEnvironment({
            FFMPEG_PATH: '/usr/bin/ffmpeg',
            FFPROBE_PATH: '/usr/bin/ffprobe',
        })
        expect(env.ffmpegPath).toBe('/usr/bin/ffmpeg')
        expect(env.ffprobePath).toBe('/usr/bin/ffprobe')
    })

    it('refuses to boot with an upload limit above a single S3 PUT', () => {
        expect(() => loadEnvironment({ MAX_VIDEO_UPLOAD_MB: '10240' })).toThrow(
            'MAX_VIDEO_UPLOAD_MB=10240 exceeds 5120',
        )
    })

    it('refuses a transcode timeout that looks like seconds', () => {
        expect(() => loadEnvironment({ VIDEO_TRANSCODE_TIMEOUT_MS: '1800' })).toThrow(
            'below the 60000ms floor',
        )
    })
})
