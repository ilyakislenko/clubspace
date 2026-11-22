// Auto-covers for videos transcoded before the worker made them: every
// `ready` video whose thumbnailUrl is still null gets one frame, the same one
// the worker now cuts after a transcode. Idempotent — a video that has a cover
// (generated, or a coach's upload) is never touched, so a re-run only retries
// the ones that failed. See apps/video-worker/README.md for how to run it.
//
// The frame comes from the HLS rendition when there is one: a playlist and a
// single 4-second segment, instead of downloading a multi-gigabyte source for
// one picture. The stored upload is the fallback.

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import {
    downloadText,
    downloadToFile,
    ffmpegBinary,
    prisma,
    thumbnailStore,
} from '../src/clients.js'
import { environment } from '../src/environment.js'
import { pickBestVariant, pickSegment, resolvePlaylistUri } from '../src/hls-playlist.js'
import { assertTranscodable, probeVideo, restrictedInputArgs } from '../src/probe.js'
import { extractThumbnail, pickThumbnailTimeSec, publishThumbnail } from '../src/thumbnail.js'

type Candidate = {
    id: string
    title: string
    duration: number | null
    rawBucket: string | null
    rawKey: string | null
    hlsBucket: string | null
    hlsMasterKey: string | null
}

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

// One segment of our own HLS output. It is ffmpeg's mpegts, written by this
// worker, so the mpegts demuxer is pinned rather than whitelisted.
async function frameFromHls(video: Candidate, workdir: string, outputPath: string) {
    const bucket = video.hlsBucket || environment.s3Storage.s3BucketName
    const masterKey = video.hlsMasterKey as string
    const variantUri = pickBestVariant(await downloadText(bucket, masterKey))
    const variantKey = variantUri && resolvePlaylistUri(masterKey, variantUri)
    if (!variantKey) throw new Error('no variant in the master playlist')

    const segment = pickSegment(
        await downloadText(bucket, variantKey),
        pickThumbnailTimeSec(video.duration),
    )
    const segmentKey = segment && resolvePlaylistUri(variantKey, segment.uri)
    if (!segment || !segmentKey) throw new Error('no segment in the media playlist')

    const segmentPath = join(workdir, 'segment.ts')
    await downloadToFile(bucket, segmentKey, segmentPath)
    await extractThumbnail({
        binary: ffmpegBinary,
        inputArgs: ['-protocol_whitelist', 'file', '-f', 'mpegts'],
        inputPath: segmentPath,
        outputPath,
        atSec: segment.offsetSec,
    })
}

// The coach's upload, vetted exactly like the transcode does.
async function frameFromRaw(video: Candidate, workdir: string, outputPath: string) {
    const bucket = video.rawBucket || environment.s3Storage.s3BucketName
    const inputPath = join(workdir, 'source')
    await downloadToFile(bucket, video.rawKey as string, inputPath)
    const probe = await probeVideo(inputPath, {
        binary: environment.ffprobePath,
        timeoutMs: 60_000,
    })
    const demuxer = assertTranscodable(probe, environment)
    await extractThumbnail({
        binary: ffmpegBinary,
        inputArgs: restrictedInputArgs(demuxer),
        inputPath,
        outputPath,
        atSec: pickThumbnailTimeSec(probe.durationSec ?? video.duration),
    })
}

async function backfill(video: Candidate): Promise<'created' | 'kept'> {
    const workdir = await fs.mkdtemp(join(tmpdir(), `thumbnail-${video.id}-`))
    const outputPath = join(workdir, 'thumbnail.jpg')
    try {
        const sources: Array<{ name: string; run: typeof frameFromHls }> = []
        if (video.hlsMasterKey) sources.push({ name: 'hls', run: frameFromHls })
        if (video.rawKey) sources.push({ name: 'raw', run: frameFromRaw })
        if (sources.length === 0) throw new Error('neither HLS output nor a stored upload')

        const failures: string[] = []
        for (const source of sources) {
            try {
                await source.run(video, workdir, outputPath)
                return await publishThumbnail(prisma, thumbnailStore, video.id, outputPath)
            } catch (error) {
                failures.push(`${source.name}: ${errorText(error)}`)
            }
        }
        throw new Error(failures.join('; '))
    } finally {
        await fs.rm(workdir, { recursive: true, force: true })
    }
}

async function main() {
    const videos: Candidate[] = await prisma.video.findMany({
        where: { status: 'ready', thumbnailUrl: null },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            title: true,
            duration: true,
            rawBucket: true,
            rawKey: true,
            hlsBucket: true,
            hlsMasterKey: true,
        },
    })
    console.log(`[backfill-thumbnails] ${videos.length} ready video(s) without a cover`)

    const created: string[] = []
    const kept: string[] = []
    const failed: Array<{ id: string; title: string; error: string }> = []
    // One at a time: each run is an ffmpeg decode next to a live worker.
    for (const video of videos) {
        try {
            const outcome = await backfill(video)
            ;(outcome === 'created' ? created : kept).push(video.id)
            console.log(`[backfill-thumbnails] ${outcome} ${video.id} «${video.title}»`)
        } catch (error) {
            failed.push({ id: video.id, title: video.title, error: errorText(error) })
            console.error(
                `[backfill-thumbnails] failed ${video.id} «${video.title}»: ${errorText(error)}`,
            )
        }
    }

    console.log('[backfill-thumbnails] summary', {
        candidates: videos.length,
        created: created.length,
        // Got a cover from someone else while this ran; left as it was.
        keptExisting: kept.length,
        failed: failed.length,
    })
    if (failed.length > 0) {
        console.log('[backfill-thumbnails] failed videos', failed)
        process.exitCode = 1
    }
}

main()
    .catch((error) => {
        console.error('[backfill-thumbnails] aborted', error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
