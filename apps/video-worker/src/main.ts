import * as Sentry from '@sentry/node'
import { Queue, UnrecoverableError, Worker } from 'bullmq'
import { spawn, type ChildProcessByStdio } from 'child_process'
import { Readable } from 'stream'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, relative, sep } from 'path'

import {
    downloadToFile,
    downloadVettedSource,
    ffmpegBinary,
    getEndpoint,
    getPublicObjectUrl,
    prisma,
    s3Client,
    subtitleStore,
    thumbnailStore,
    uploadFile,
} from './clients.js'
import { environment } from './environment.js'
import {
    assertTranscodable,
    type Demuxer,
    probeVideo,
    RejectedInputError,
    restrictedInputArgs,
} from './probe.js'
import { llmConfigFrom, LlmUnavailableError, whisperConfigFrom } from './speech.js'
import { extractThumbnail, pickThumbnailTimeSec, publishThumbnail } from './thumbnail.js'
import { processVideoText } from './video-text.js'
import { markReviewClipFailed, processReviewClip, type ReviewClipDeps } from './review-clip.js'
import { indexVideoTechniques } from './technique-index.js'

// Whisper makes transcripts (so subtitles, and chapters from speech); the
// chat endpoint vets OCR titles, names chapters from speech and translates
// subtitles. Without either, OCR titles alone.
const llmConfig = llmConfigFrom(environment.chaptersLlm)
const whisperConfig = whisperConfigFrom(environment)

// Same DSN variable as the server; empty disables reporting.
if (environment.sentry.dsn) {
    Sentry.init({
        dsn: environment.sentry.dsn,
        environment: environment.sentry.environment,
    })
}

const connection = {
    host: environment.redis.host,
    port: environment.redis.port,
    password: environment.redis.password,
    db: environment.redis.db,
}

const readyQueue = new Queue('video-ready', { connection })
// Automatic chapters run as their own job after the transcode, never inside
// it: a restart mid-OCR must not re-run a finished transcode.
const chaptersQueue = new Queue('video-chapters', { connection })

console.log('[video-worker] starting...', {
    redis: {
      host: connection.host,
      port: connection.port,
      db: connection.db,
      hasPassword: Boolean(connection.password),
    },
    s3: {
      endpoint: environment.s3Storage.s3InternalUrl ?? getEndpoint() ?? '(default)',
      region: environment.s3Storage.s3Region,
      forcePathStyle: environment.s3Storage.s3ForcePathStyle,
      bucket: environment.s3Storage.s3BucketName,
    },
    concurrency: environment.concurrency,
    sentry: Boolean(environment.sentry.dsn),
    chaptersLlm: llmConfig ? `${llmConfig.model} at ${llmConfig.baseUrl}` : 'off',
    whisper: whisperConfig ? 'on' : 'off: WHISPER_MODEL_PATH is not set',
  })
  

// «Разбор видео» clips: the ReviewClip rows (never `Video`).
const reviewClipDb: ReviewClipDeps['db'] = {
    reviewClip: {
        findUnique: (args) =>
            prisma.reviewClip.findUnique({
                ...args,
                select: { rawBucket: true, rawKey: true, hlsBucket: true },
            }),
        update: (args) => prisma.reviewClip.update(args),
    },
}

// The lesson transcode's own steps, wired for review clips.
const reviewClipDeps: ReviewClipDeps = {
    db: reviewClipDb,
    makeWorkdir: (clipId) => fs.mkdtemp(join(tmpdir(), `review-${clipId}-`)),
    removeWorkdir: (dir) => fs.rm(dir, { recursive: true, force: true }),
    download: downloadToFile,
    probe: (filePath) =>
        probeVideo(filePath, { binary: environment.ffprobePath, timeoutMs: 60_000 }),
    assertTranscodable: (probe) => assertTranscodable(probe, environment),
    transcode: runFfmpeg,
    uploadDir: async (bucket, prefix, dir) => {
        for (const absPath of await walkDir(dir)) {
            const rel = relative(dir, absPath).split(sep).join('/')
            await uploadFile(bucket, `${prefix}${rel}`, absPath)
        }
    },
    extractThumbnail: (o) =>
        extractThumbnail({
            binary: ffmpegBinary,
            // The upload is untrusted: same whitelists as the transcode.
            inputArgs: restrictedInputArgs(o.demuxer),
            inputPath: o.inputPath,
            outputPath: o.outputPath,
            atSec: o.atSec,
        }),
    uploadFile: (bucket, key, filePath, contentType) =>
        uploadFile(bucket, key, filePath, contentType),
    deletePrefix: deleteObjectsUnder,
    log: (message, details) => console.log(`[video-worker] ${message}`, details),
}

const worker = new Worker(
    'video-transcode',
    async (job) => {
        // A member's «Разбор видео» clip: its own table, private storage and
        // none of the lesson extras (see review-clip.ts).
        const reviewClipId = job.data?.reviewClipId as string | undefined
        if (reviewClipId) {
            console.log('[video-worker] review clip job started', { reviewClipId })
            await processReviewClip(reviewClipDeps, reviewClipId)
            console.log('[video-worker] review clip job completed', { reviewClipId })
            return
        }

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

            const probe = await probeVideo(inputPath, {
                binary: environment.ffprobePath,
                timeoutMs: 60_000,
            })
            const demuxer = assertTranscodable(probe, environment)

            await fs.mkdir(outputDir, { recursive: true })

            await runFfmpeg(inputPath, demuxer, outputDir)

            const outputPrefix = `hls/${videoId}`
            const files = await walkDir(outputDir)
            for (const absPath of files) {
                const rel = relative(outputDir, absPath).split(sep).join('/')
                const key = `${outputPrefix}/${rel}`
                await uploadFile(hlsBucket, key, absPath)
            }

            const masterKey = `${outputPrefix}/master.m3u8`

            // Before the row flips to ready, so the video shows up in lists
            // with its cover. Never fails the job: a video without a cover
            // still plays.
            if (!video.thumbnailUrl) {
                await makeThumbnail({
                    videoId,
                    inputPath,
                    demuxer,
                    durationSec: probe.durationSec,
                    outputPath: join(workdir, 'thumbnail.jpg'),
                })
            }

            await prisma.video.update({
                where: { id: videoId },
                data: {
                    status: 'ready',
                    hlsBucket,
                    hlsMasterKey: masterKey,
                    url: getPublicObjectUrl(hlsBucket, masterKey),
                    // Lesson lists show it and web playback links are sized
                    // by it; without it both wait for a first viewer's player
                    // to report the length.
                    ...(probe.durationSec !== null && {
                        duration: Math.round(probe.durationSec),
                    }),
                },
            })

            await readyQueue.add(
                'video-ready',
                { videoId, workspaceId: video.workspaceId },
                {
                    removeOnComplete: 1000,
                    // Kept for a week so a failed hand-off can be inspected.
                    removeOnFail: { age: 7 * 24 * 60 * 60 },
                },
            )

            // Its own job: the transcode is done whatever happens to the
            // chapters, and a restart while they are read retries only them.
            await enqueueChapters(videoId)

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
            await deleteObjectsUnder(hlsBucket, `hls/${videoId}/`).catch((cleanupError) => {
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
    { connection, concurrency: environment.concurrency },
)

worker.on('failed', async (job, err) => {
    console.error('Video transcode failed', job?.id, err)
    // A «Разбор видео» clip: the same «done with the job» rule, its own row.
    const reviewClipId = job?.data?.reviewClipId as string | undefined
    if (job && reviewClipId) {
        if (!job.finishedOn) return
        if (!(err instanceof RejectedInputError)) {
            Sentry.captureException(err, { tags: { reviewClipId } })
        }
        await markReviewClipFailed(reviewClipDb, reviewClipId, err)
        return
    }
    const videoId = job?.data?.videoId as string | undefined
    if (!job || !videoId) return
    // Mark the video failed once BullMQ is done with the job — which is not
    // the same as "retries exhausted". BullMQ stamps finishedOn only when it
    // has decided against another attempt, so this one field covers every
    // ending: retries used up, an unrecoverable error (which finishes on
    // attempt 1, so an attempt counter would miss it and strand the row on
    // 'processing'), a discarded job, and a worker killed mid-transcode.
    if (!job.finishedOn) return
    // A refused upload is the coach's file, not a fault worth an alert.
    if (!(err instanceof RejectedInputError)) {
        Sentry.captureException(err, { tags: { videoId } })
    }
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

// Cuts the cover from the source already on disk. Logs and reports a failure
// instead of throwing: see the call site.
async function makeThumbnail(options: {
    videoId: string
    inputPath: string
    demuxer: Demuxer
    durationSec: number | null
    outputPath: string
}) {
    try {
        await extractThumbnail({
            binary: ffmpegBinary,
            // The upload is untrusted: same whitelists and pinned demuxer as
            // the transcode.
            inputArgs: restrictedInputArgs(options.demuxer),
            inputPath: options.inputPath,
            outputPath: options.outputPath,
            atSec: pickThumbnailTimeSec(options.durationSec),
        })
        const outcome = await publishThumbnail(
            prisma,
            thumbnailStore,
            options.videoId,
            options.outputPath,
        )
        console.log('[video-worker] thumbnail', { videoId: options.videoId, outcome })
    } catch (error) {
        console.error('[video-worker] thumbnail failed', {
            videoId: options.videoId,
            error: error instanceof Error ? error.message : String(error),
        })
        Sentry.captureException(error, {
            tags: { videoId: options.videoId, step: 'thumbnail' },
        })
    }
}

// Queues the chapter scan for a transcoded video. The job id makes it
// idempotent: a transcode re-run while the scan is queued adds nothing.
// Never fails the transcode — the backfill picks up a video left unscanned.
async function enqueueChapters(videoId: string) {
    try {
        await chaptersQueue.add(
            'video-chapters',
            { videoId },
            { jobId: `chapters-${videoId}`, removeOnComplete: true, removeOnFail: true },
        )
    } catch (error) {
        console.error('[video-worker] chapters not queued', {
            videoId,
            error: error instanceof Error ? error.message : String(error),
        })
        Sentry.captureException(error, { tags: { videoId, step: 'chapters' } })
    }
}

// An unreachable or unpaid model (HTTP 402) is the same state for every
// video: reported to Sentry once per process, a warning after that.
let llmUnavailableReported = false

// The `video-chapters` job: the transcript and automatic subtitles, and
// chapters from titles burned into the video or else from what the instructor
// says (video-text.ts). Safe to re-run: a scanned video
// (Video.chaptersScannedAt) is skipped, and every step re-checks before it
// writes. A failure is logged and reported, never retried here — the
// backfills retry.
//
// `regenerate` (staff's «Пересоздать» in admin, job `chapters-regen-<id>`):
// the server has already removed the automatic chapters and/or subtitles, so
// the scan stamp doesn't stop it; chapters are made only if the server cleared
// the stamp (it does when chapters were asked for), and the subtitles whose
// automatic tracks it removed are made again from the stored transcript.
async function runChaptersJob(videoId: string, regenerate = false) {
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { status: true, rawBucket: true, rawKey: true, chaptersScannedAt: true },
    })
    if (!video || video.status !== 'ready' || (video.chaptersScannedAt && !regenerate)) {
        console.log('[video-worker] chapters skipped', {
            videoId,
            reason: !video ? 'gone' : video.chaptersScannedAt ? 'scanned' : video.status,
        })
        return
    }
    const startedAt = Date.now()
    const workdir = await fs.mkdtemp(join(tmpdir(), `chapters-${videoId}-`))
    try {
        const run = await processVideoText(
            {
                prisma,
                videoId,
                ffmpegBinary,
                workdir,
                llm: llmConfig,
                whisper: whisperConfig,
                subtitleStore,
                loadSource: () => downloadVettedSource(video, join(workdir, 'source')),
            },
            { chapters: !video.chaptersScannedAt },
        )
        console.log('[video-worker] chapters', { videoId, ...run, ms: Date.now() - startedAt })
    } catch (error) {
        const details = {
            videoId,
            error: error instanceof Error ? error.message : String(error),
            ms: Date.now() - startedAt,
        }
        if (error instanceof LlmUnavailableError) {
            console.warn('[video-worker] chapters: model unavailable', details)
            if (llmUnavailableReported) return
            llmUnavailableReported = true
        } else {
            console.error('[video-worker] chapters failed', details)
        }
        Sentry.captureException(error, { tags: { videoId, step: 'chapters' } })
    } finally {
        await fs.rm(workdir, { recursive: true, force: true })
        // «Техники»: from whatever chapters and transcript the lesson has now
        // (a failed step above still leaves the rest worth indexing).
        await indexVideoTechniques(prisma, videoId)
            .then((found) => console.log('[video-worker] techniques', { videoId, found }))
            .catch((error: unknown) => {
                console.error('[video-worker] techniques failed', { videoId, error: String(error) })
                Sentry.captureException(error, { tags: { videoId, step: 'techniques' } })
            })
    }
}

// One scan at a time: each is a full decode, OCR and maybe Whisper, next to
// the transcodes.
const chaptersWorker = new Worker(
    'video-chapters',
    async (job) => {
        const videoId = job.data?.videoId as string | undefined
        if (!videoId) throw new Error('[video-worker] chapters job has no videoId')
        await runChaptersJob(videoId, job.data?.regenerate === true)
    },
    { connection, concurrency: 1 },
)

// Best-effort removal of every object under a prefix (hls/<videoId>/,
// hls/review/<clipId>/) — used to clean up partial output when a transcode
// fails midway through the upload loop.
async function deleteObjectsUnder(bucket: string, prefix: string) {
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
//
// Capped at 720p for now. The first install serves segments straight off a
// home uplink measured at ~30 Mbit/s, where a 4800k rung saturates the line at
// four concurrent viewers — and once it saturates, every player oscillates
// between variants rather than one degrading. Restore the 1080p rung when
// egress stops riding that link.
const LADDER = [
    { height: 480, vBitrate: '900k', aBitrate: '96k', maxrate: '1080k', bufsize: '1500k' },
    { height: 720, vBitrate: '2400k', aBitrate: '128k', maxrate: '2856k', bufsize: '4000k' },
] as const

async function runFfmpeg(inputPath: string, demuxer: Demuxer, outputDir: string) {
    for (let i = 0; i < LADDER.length; i += 1) {
        await fs.mkdir(join(outputDir, `v${i}`), { recursive: true })
    }

    await new Promise<void>((resolve, reject) => {
        const args: string[] = [
            '-y',
            // Pinned to the demuxer the probe accepted, local files only.
            ...restrictedInputArgs(demuxer),
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

        const ffmpegProcess: ChildProcessByStdio<null, Readable, Readable> =
            spawn(ffmpegBinary, args, {
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

async function shutdown() {
    // Waits for the jobs in progress. A scan killed midway is not stamped:
    // BullMQ re-runs it as a stalled job, or the backfill picks it up.
    await Promise.all([worker.close(), chaptersWorker.close()])
    await Promise.all([readyQueue.close(), chaptersQueue.close()])
    await prisma.$disconnect()
    // Deliver anything still queued before the container goes away.
    await Sentry.close(2000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
