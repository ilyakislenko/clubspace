import { join } from 'path'

import { type Demuxer, type ProbeResult, RejectedInputError } from './probe.js'
import { pickThumbnailTimeSec } from './thumbnail.js'

// «Разбор видео»: a member's own clip sent for a coach's review. It lives in
// the server's ReviewClip table (never in Video, so no club list can show it)
// and comes on the same `video-transcode` queue as `{ reviewClipId }`. The
// transcode is the lesson one; then everything stays private under
// hls/review/<id>/ (the cover too — not the public thumbnails/), and none of
// the lesson extras run: no ready hand-off, chapters, transcript or subtitles.

// A clip is a short piece of drilling or sparring (the server's limit too).
export const MAX_REVIEW_CLIP_DURATION_SEC = 10 * 60

export const reviewClipHlsPrefix = (clipId: string) => `hls/review/${clipId}/`

type ClipRow = {
    rawBucket: string
    rawKey: string
    hlsBucket: string
}

type ClipUpdate = {
    status: 'processing' | 'ready' | 'failed'
    errorMessage?: string | null
    hlsMasterKey?: string
    thumbnailKey?: string | null
    duration?: number
}

export type ReviewClipDeps = {
    db: {
        reviewClip: {
            findUnique(args: { where: { id: string } }): Promise<ClipRow | null>
            update(args: { where: { id: string }; data: ClipUpdate }): Promise<unknown>
        }
    }
    makeWorkdir(clipId: string): Promise<string>
    removeWorkdir(dir: string): Promise<void>
    download(bucket: string, key: string, filePath: string): Promise<void>
    probe(filePath: string): Promise<ProbeResult>
    // Throws RejectedInputError for a file the transcode refuses.
    assertTranscodable(probe: ProbeResult): Demuxer
    transcode(inputPath: string, demuxer: Demuxer, outputDir: string): Promise<void>
    // Every file under `dir`, uploaded under `prefix` (relative paths kept).
    uploadDir(bucket: string, prefix: string, dir: string): Promise<void>
    extractThumbnail(options: {
        inputPath: string
        demuxer: Demuxer
        atSec: number
        outputPath: string
    }): Promise<void>
    uploadFile(bucket: string, key: string, filePath: string, contentType: string): Promise<void>
    deletePrefix(bucket: string, prefix: string): Promise<void>
    log(message: string, details: Record<string, unknown>): void
}

/**
 * Transcodes one review clip and marks it ready. A failure removes whatever
 * HLS objects were written and rethrows, so BullMQ retries; the clip is
 * marked failed by `markReviewClipFailed` once BullMQ gives up.
 */
export async function processReviewClip(deps: ReviewClipDeps, clipId: string): Promise<void> {
    const clip = await deps.db.reviewClip.findUnique({ where: { id: clipId } })
    // Deleted by the member before the job ran: nothing to do.
    if (!clip) {
        deps.log('review clip not found, skipping', { clipId })
        return
    }

    await deps.db.reviewClip.update({
        where: { id: clipId },
        data: { status: 'processing', errorMessage: null },
    })

    const workdir = await deps.makeWorkdir(clipId)
    const inputPath = join(workdir, 'source')
    const outputDir = join(workdir, 'hls')
    const prefix = reviewClipHlsPrefix(clipId)
    try {
        await deps.download(clip.rawBucket, clip.rawKey, inputPath)
        const probe = await deps.probe(inputPath)
        const demuxer = deps.assertTranscodable(probe)
        if (probe.durationSec !== null && probe.durationSec > MAX_REVIEW_CLIP_DURATION_SEC) {
            throw new RejectedInputError('Видео длиннее 10 минут — обрежьте его и отправьте снова')
        }

        await deps.transcode(inputPath, demuxer, outputDir)
        await deps.uploadDir(clip.hlsBucket, prefix, outputDir)
        const thumbnailKey = await makeCover(deps, {
            clipId,
            bucket: clip.hlsBucket,
            key: `${prefix}thumbnail.jpg`,
            inputPath,
            demuxer,
            durationSec: probe.durationSec,
            outputPath: join(workdir, 'thumbnail.jpg'),
        })

        await deps.db.reviewClip.update({
            where: { id: clipId },
            data: {
                status: 'ready',
                hlsMasterKey: `${prefix}master.m3u8`,
                thumbnailKey,
                ...(probe.durationSec !== null && {
                    duration: Math.round(probe.durationSec),
                }),
            },
        })
    } catch (error) {
        await deps.deletePrefix(clip.hlsBucket, prefix).catch((cleanupError: unknown) => {
            deps.log('review clip hls cleanup failed', { clipId, error: String(cleanupError) })
        })
        throw error
    } finally {
        await deps.removeWorkdir(workdir)
    }
}

// The cover, private beside the renditions. A clip without one still plays,
// so a failure is logged and the key left null.
async function makeCover(
    deps: ReviewClipDeps,
    o: {
        clipId: string
        bucket: string
        key: string
        inputPath: string
        demuxer: Demuxer
        durationSec: number | null
        outputPath: string
    },
): Promise<string | null> {
    try {
        await deps.extractThumbnail({
            inputPath: o.inputPath,
            demuxer: o.demuxer,
            atSec: pickThumbnailTimeSec(o.durationSec),
            outputPath: o.outputPath,
        })
        await deps.uploadFile(o.bucket, o.key, o.outputPath, 'image/jpeg')
        return o.key
    } catch (error) {
        deps.log('review clip thumbnail failed', {
            clipId: o.clipId,
            error: error instanceof Error ? error.message : String(error),
        })
        return null
    }
}

/** Once BullMQ is done with a failed job: the member sees why. */
export async function markReviewClipFailed(
    db: ReviewClipDeps['db'],
    clipId: string,
    error: unknown,
): Promise<void> {
    await db.reviewClip
        .update({
            where: { id: clipId },
            data: {
                status: 'failed',
                errorMessage:
                    error instanceof RejectedInputError
                        ? error.message
                        : 'Не удалось обработать видео — попробуйте отправить его снова',
            },
        })
        .catch(() => {
            // Deleted mid-flight — nothing to record.
        })
}
