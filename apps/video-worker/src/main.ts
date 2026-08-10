import { S3 } from '@aws-sdk/client-s3'
import { Queue, UnrecoverableError, Worker } from 'bullmq'
import { spawn, type ChildProcessByStdio } from 'child_process'
import { Readable } from 'stream'
import { env as nodeEnv } from 'process'
import ffmpegPath from 'ffmpeg-static'
import { createWriteStream, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, relative, sep } from 'path'
import { pipeline } from 'stream/promises'

import { PrismaClient } from '@clubspace/prisma-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { environment } from './environment.js'

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: environment.databaseUrl }),
})

const s3Client = new S3({
    endpoint: getEndpoint(),
    credentials: {
        accessKeyId: environment.s3Storage.s3AccessKeyId,
        secretAccessKey: environment.s3Storage.s3SecretAccessKey,
    },
    region: environment.s3Storage.s3Region,
    forcePathStyle: environment.s3Storage.s3ForcePathStyle,
})

const connection = {
    host: environment.redis.host,
    port: environment.redis.port,
    password: environment.redis.password,
    db: environment.redis.db,
}

const readyQueue = new Queue('video-ready', { connection })

console.log('[video-worker] starting...', {
    redis: {
      host: connection.host,
      port: connection.port,
      db: connection.db,
      hasPassword: Boolean(connection.password),
    },
    s3: {
      endpoint: getEndpoint() ?? '(default)',
      region: environment.s3Storage.s3Region,
      forcePathStyle: environment.s3Storage.s3ForcePathStyle,
      bucket: environment.s3Storage.s3BucketName,
    },
  })
  

const worker = new Worker(
    'video-transcode',
    async (job) => {
        const videoId = job.data?.videoId as string | undefined

        // A job with no videoId is a programming error, not a no-op — throw so
        // it surfaces as a failure instead of being silently marked complete.
        if (!videoId) {
            throw new Error('[video-worker] transcode job has no videoId')
        }

        console.log('[video-worker] job started', { videoId })

        const video = await prisma.video.findUnique({
            where: { id: videoId },
        })

        // The video was deleted between enqueue and processing — genuinely
        // nothing to do, so complete quietly.
        if (!video) {
            console.warn('[video-worker] video not found, skipping', { videoId })
            return
        }

        // An existing row with no rawKey is a bad state — fail loudly.
        if (!video.rawKey) {
            throw new Error(`[video-worker] video ${videoId} has no rawKey`)
        }

        const rawBucket = video.rawBucket || environment.s3Storage.s3BucketName
        const hlsBucket = video.hlsBucket || environment.s3Storage.s3BucketName

        const workdir = await fs.mkdtemp(join(tmpdir(), `video-${videoId}-`))
        const inputPath = join(workdir, 'source.mp4')
        const outputDir = join(workdir, 'hls')

            await prisma.video.update({
            where: { id: videoId },
            data: { status: 'processing', errorMessage: null },
        })

        try {
            await downloadToFile(rawBucket, video.rawKey, inputPath)

            await fs.mkdir(outputDir, { recursive: true })

            await runFfmpeg(inputPath, outputDir)

            const outputPrefix = `hls/${videoId}`
            const files = await walkDir(outputDir)
            for (const absPath of files) {
                const rel = relative(outputDir, absPath).split(sep).join('/')
                const key = `${outputPrefix}/${rel}`
                await uploadFile(hlsBucket, key, absPath)
            }

            const masterKey = `${outputPrefix}/master.m3u8`

            await prisma.video.update({
                where: { id: videoId },
                data: {
                    status: 'ready',
                    hlsBucket,
                    hlsMasterKey: masterKey,
                    url: getPublicObjectUrl(hlsBucket, masterKey),
                },
            })

            await readyQueue.add(
                'video-ready',
                { videoId, workspaceId: video.workspaceId },
                { removeOnComplete: 1000, removeOnFail: 1000 },
            )

            console.log('[video-worker] job completed', { videoId })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.error('[video-worker] job failed', {
                videoId,
                attempt: job.attemptsMade + 1,
                error: message,
            })
            // Drop any partially-uploaded HLS objects so a retry starts from a
            // clean prefix and a permanently-failed video leaves no orphans.
            await deleteHlsPrefix(hlsBucket, videoId).catch((cleanupError) => {
                console.error('[video-worker] hls cleanup failed', {
                    videoId,
                    error: String(cleanupError),
                })
            })
            // Rethrow so BullMQ honours the producer's attempts/backoff. The
            // row is flipped to 'failed' only once retries are exhausted (see
            // the 'failed' handler), so a transient error doesn't prematurely
            // show the video as broken.
            throw error
        } finally {
            await fs.rm(workdir, { recursive: true, force: true })
        }
    },
    { connection, concurrency: 1 },
)

worker.on('failed', async (job, err) => {
    console.error('Video transcode failed', job?.id, err)
    const videoId = job?.data?.videoId as string | undefined
    if (!job || !videoId) return
    // Mark the video failed once BullMQ is done with the job — which is not
    // the same as "retries exhausted". BullMQ stamps finishedOn only when it
    // has decided against another attempt, so this one field covers every
    // ending: retries used up, an unrecoverable error (which finishes on
    // attempt 1, so an attempt counter would miss it and strand the row on
    // 'processing'), a discarded job, and a worker killed mid-transcode.
    if (!job.finishedOn) return
    await prisma.video
        .update({
            where: { id: videoId },
            data: {
                status: 'failed',
                errorMessage: err?.message ?? 'Transcode failed',
            },
        })
        .catch(() => {
            // Row may have been deleted mid-flight — nothing to record.
        })
})

async function downloadToFile(bucket: string, key: string, filePath: string) {
    const response = await s3Client.getObject({ Bucket: bucket, Key: key })
    if (!response.Body) {
        throw new Error('Empty S3 response body')
    }
    await pipeline(response.Body as NodeJS.ReadableStream, createWriteStream(filePath))
}

async function uploadFile(bucket: string, key: string, filePath: string) {
    const contentType = key.endsWith('.m3u8')
        ? 'application/vnd.apple.mpegurl'
        : key.endsWith('.ts')
        ? 'video/mp2t'
        : undefined

    await s3Client.putObject({
        Bucket: bucket,
        Key: key,
        Body: await fs.readFile(filePath),
        ContentType: contentType,
    })
}

// Best-effort removal of every object under hls/<videoId>/ — used to clean up
// partial output when a transcode fails midway through the upload loop.
async function deleteHlsPrefix(bucket: string, videoId: string) {
    const prefix = `hls/${videoId}/`
    let continuationToken: string | undefined
    do {
        const listed = await s3Client.listObjectsV2({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        })
        const objects = (listed.Contents ?? [])
            .map((o) => o.Key)
            .filter((key): key is string => Boolean(key))
            .map((Key) => ({ Key }))
        if (objects.length > 0) {
            await s3Client.deleteObjects({
                Bucket: bucket,
                Delete: { Objects: objects },
            })
        }
        continuationToken = listed.IsTruncated
            ? listed.NextContinuationToken
            : undefined
    } while (continuationToken)
}

async function walkDir(dir: string): Promise<string[]> {
    const result: string[] = []
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) {
            result.push(...(await walkDir(abs)))
        } else {
            result.push(abs)
        }
    }
    return result
}

// Multi-bitrate HLS ladder. Heights ordered low→high so cellular clients
// pick the lowest variant first. If the source is shorter than a target,
// FFmpeg upscales — acceptable for an MVP, replace with adaptive ladder
// detection (probe ffprobe height, drop variants above source) later.
const LADDER = [
    { height: 480, vBitrate: '900k', aBitrate: '96k', maxrate: '1080k', bufsize: '1500k' },
    { height: 720, vBitrate: '2400k', aBitrate: '128k', maxrate: '2856k', bufsize: '4000k' },
    { height: 1080, vBitrate: '4800k', aBitrate: '192k', maxrate: '5712k', bufsize: '8000k' },
] as const

async function runFfmpeg(inputPath: string, outputDir: string) {
    for (let i = 0; i < LADDER.length; i += 1) {
        await fs.mkdir(join(outputDir, `v${i}`), { recursive: true })
    }

    await new Promise<void>((resolve, reject) => {
        const args: string[] = [
            '-y',
            '-i',
            inputPath,
            '-fflags',
            '+genpts',
            '-avoid_negative_ts',
            'make_zero',
        ]

        // For each variant: map source to a separate output stream pair, scale
        // to target height keeping aspect ratio, encode H.264 + AAC at that bitrate.
        for (let i = 0; i < LADDER.length; i += 1) {
            args.push('-map', '0:v:0', '-map', '0:a:0?')
        }

        LADDER.forEach((rung, idx) => {
            args.push(
                `-filter:v:${idx}`,
                `scale=-2:${rung.height}`,
                `-c:v:${idx}`,
                'h264',
                `-b:v:${idx}`,
                rung.vBitrate,
                `-maxrate:v:${idx}`,
                rung.maxrate,
                `-bufsize:v:${idx}`,
                rung.bufsize,
                `-c:a:${idx}`,
                'aac',
                `-b:a:${idx}`,
                rung.aBitrate,
                `-ar:a:${idx}`,
                '48000',
            )
        })

        args.push(
            '-preset',
            'veryfast',
            '-g',
            '48',
            '-keyint_min',
            '48',
            '-sc_threshold',
            '0',
            '-force_key_frames',
            'expr:gte(t,n_forced*4)',
            '-hls_time',
            '4',
            '-hls_playlist_type',
            'vod',
            '-hls_flags',
            'independent_segments',
            '-master_pl_name',
            'master.m3u8',
            '-var_stream_map',
            LADDER.map((_, idx) => `v:${idx},a:${idx}`).join(' '),
            '-hls_segment_filename',
            join(outputDir, 'v%v', 'seg_%05d.ts'),
            '-f',
            'hls',
            join(outputDir, 'v%v', 'playlist.m3u8'),
        )

        const binary =
            nodeEnv.FFMPEG_PATH ??
            (ffmpegPath as unknown as string | null) ??
            'ffmpeg'
        const ffmpegProcess: ChildProcessByStdio<null, Readable, Readable> =
            spawn(binary, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            })
        let stderr = ''
        let timedOut = false

        ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
            if (stderr.length > 5000) {
                stderr = stderr.slice(-5000)
            }
        })

        // SIGKILL, not SIGTERM: the reason we are here is that ffmpeg stopped
        // responding, and a process ignoring one signal will ignore the other.
        const timer = setTimeout(() => {
            timedOut = true
            ffmpegProcess.kill('SIGKILL')
        }, environment.transcodeTimeoutMs)

        ffmpegProcess.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(err)
        })
        ffmpegProcess.on('close', (code: number | null) => {
            clearTimeout(timer)
            // Success first: the timer can fire in the window between ffmpeg
            // exiting 0 and `close` being delivered. Checking timedOut ahead of
            // the exit code would throw away a finished ladder and — since the
            // timeout is unrecoverable — mark the video permanently failed.
            if (code === 0) {
                resolve()
            } else if (timedOut) {
                // Unrecoverable: retrying a hung encode just blocks the queue
                // for another timeout, three times over. Whatever is wrong with
                // this input will still be wrong in five minutes.
                reject(
                    new UnrecoverableError(
                        `ffmpeg exceeded ${environment.transcodeTimeoutMs}ms and was killed`,
                    ),
                )
            } else {
                reject(new Error(stderr || `ffmpeg exited with code ${code}`))
            }
        })
    })
}

function getEndpoint() {
    if (environment.s3Storage.s3AccelerateUrl) {
        return environment.s3Storage.s3AccelerateUrl
    }

    if (environment.s3Storage.s3BucketName) {
        const url = new URL(environment.s3Storage.s3UploadBucketUrl)
        if (url.hostname.startsWith(environment.s3Storage.s3BucketName + '.')) {
            return undefined
        }
    }

    return environment.s3Storage.s3UploadBucketUrl
}

function getPublicObjectUrl(bucket: string, key: string) {
    const host = environment.s3Storage.s3UploadBucketUrl
        .replace('s3:', 'localhost:')
        .replace(/\/$/, '')
    const isVirtualHost = host.includes(bucket)
    const baseUrl = isVirtualHost ? host : `${host}/${bucket}`
    return `${baseUrl}/${key}`
}

async function shutdown() {
    await worker.close()
    await readyQueue.close()
    await prisma.$disconnect()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
