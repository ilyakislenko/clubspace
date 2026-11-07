// Automatic chapters for videos the worker has not scanned: every `ready`
// video whose chaptersScannedAt is null gets the chain the worker's
// `video-chapters` job runs — titles on screen (vetted by the chat model when
// configured), else speech. A video that already has chapters (a coach's) is
// only stamped, nothing is downloaded. Idempotent — a finished scan stamps the
// video, so a re-run only revisits failures (the model unreachable or unpaid,
// a broken file); chapters staff deleted from a scanned video are not brought
// back.
//
// --rescan-auto: scan again every `ready` video without a manual chapter —
// its automatic ('ocr'/'speech') chapters are deleted and its stamp cleared
// first. For after a better model or Whisper prompt; manual chapters are never
// touched, and a video with any is skipped. A video whose rescan fails is left
// with no chapters and unstamped, so a plain run retries it.
//
// --video <id> (repeatable, or comma-separated): only these videos, with
// either mode — e.g. `--rescan-auto --video <id>` rescans one video.
//
// See apps/video-worker/README.md. Reads the stored upload, like the worker:
// the passes need every part of the video, so the HLS rendition would save
// nothing and read a smaller picture.

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { downloadVettedSource, ffmpegBinary, prisma, subtitleStore } from '../src/clients.js'
import { environment } from '../src/environment.js'
import { hasFlag, videoIdsFrom } from '../src/script-args.js'
import { llmConfigFrom, whisperConfigFrom } from '../src/speech.js'
import { processVideoText } from '../src/video-text.js'

type Candidate = {
    id: string
    title: string
    rawBucket: string | null
    rawKey: string | null
}

const RESCAN_AUTO = hasFlag(process.argv, 'rescan-auto')
const VIDEO_IDS = videoIdsFrom(process.argv)

const llm = llmConfigFrom(environment.chaptersLlm)
const whisper = whisperConfigFrom(environment)

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

// Deletes the video's automatic chapters and clears its stamp, unless it has
// a manual chapter. False: left alone.
async function resetAutoChapters(videoId: string) {
    return prisma.$transaction(async (tx) => {
        if ((await tx.videoTimestamp.count({ where: { videoId, source: 'manual' } })) > 0) {
            return false
        }
        await tx.videoTimestamp.deleteMany({
            where: { videoId, source: { in: ['ocr', 'speech'] } },
        })
        await tx.video.update({ where: { id: videoId }, data: { chaptersScannedAt: null } })
        return true
    })
}

// The chapter chain — and the transcript and automatic subtitles along the
// way, when the video has none yet.
async function backfill(video: Candidate) {
    const workdir = await fs.mkdtemp(join(tmpdir(), `chapters-${video.id}-`))
    try {
        return await processVideoText(
            {
                prisma,
                videoId: video.id,
                ffmpegBinary,
                workdir,
                llm,
                whisper,
                subtitleStore,
                loadSource: () => downloadVettedSource(video, join(workdir, 'source')),
            },
            { chapters: true },
        )
    } finally {
        await fs.rm(workdir, { recursive: true, force: true })
    }
}

async function main() {
    const videos: Candidate[] = await prisma.video.findMany({
        where: {
            status: 'ready',
            ...(RESCAN_AUTO
                ? { timestamps: { none: { source: 'manual' } } }
                : { chaptersScannedAt: null }),
            ...(VIDEO_IDS.length > 0 && { id: { in: VIDEO_IDS } }),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true, rawBucket: true, rawKey: true },
    })
    console.log(
        `[backfill-chapters] ${RESCAN_AUTO ? 'rescan: ' : ''}${videos.length} ready video(s) ${RESCAN_AUTO ? 'without manual chapters' : 'not scanned for chapters'}${VIDEO_IDS.length > 0 ? ` of ${VIDEO_IDS.length} requested` : ''}`,
    )
    console.log('[backfill-chapters] chat model', llm ? `${llm.model} at ${llm.baseUrl}` : 'off')
    console.log('[backfill-chapters] whisper', whisper ? 'on' : 'off: WHISPER_MODEL_PATH is not set')

    const counts = { created: 0, none: 0, kept: 0, ocr: 0, speech: 0, skipped: 0 }
    const failed: Array<{ id: string; title: string; error: string }> = []
    // One at a time: each run is a full decode plus OCR next to a live worker.
    for (const video of videos) {
        const startedAt = Date.now()
        try {
            if (RESCAN_AUTO && !(await resetAutoChapters(video.id))) {
                counts.skipped += 1
                console.log(`[backfill-chapters] skipped ${video.id} «${video.title}»: manual chapters`)
                continue
            }
            const { chapters, snapped, subtitles } = await backfill(video)
            if (!chapters) throw new Error('the chapter step did not run')
            counts[chapters.outcome] += 1
            if (chapters.outcome === 'created' && chapters.source) counts[chapters.source] += 1
            const notes = [
                chapters.ocr?.reviewed && `titles kept by the model: ${chapters.ocr.reviewed}`,
                chapters.speech?.rejected && `speech: ${chapters.speech.rejected}`,
                snapped && `snapped: ${snapped.join(', ')}`,
                subtitles &&
                    Object.keys(subtitles).length > 0 &&
                    `subtitles: ${JSON.stringify(subtitles)}`,
            ].filter(Boolean)
            console.log(
                `[backfill-chapters] ${chapters.outcome} ${video.id} «${video.title}»: ${chapters.chapters} chapter(s)${chapters.source ? ` from ${chapters.source}` : ''}${notes.length ? ` (${notes.join('; ')})` : ''} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
            )
        } catch (error) {
            failed.push({ id: video.id, title: video.title, error: errorText(error) })
            console.error(
                `[backfill-chapters] failed ${video.id} «${video.title}»: ${errorText(error)}`,
            )
        }
    }

    console.log('[backfill-chapters] summary', {
        candidates: videos.length,
        created: counts.created,
        fromTitles: counts.ocr,
        fromSpeech: counts.speech,
        // Nothing on screen, and no usable speech (or that step is off).
        noChapters: counts.none,
        // Had chapters already (a coach's): only stamped as scanned.
        keptExisting: counts.kept,
        // --rescan-auto: has manual chapters, left alone.
        skippedManual: counts.skipped,
        failed: failed.length,
    })
    if (failed.length > 0) {
        console.log('[backfill-chapters] failed videos', failed)
        process.exitCode = 1
    }
}

main()
    .catch((error) => {
        console.error('[backfill-chapters] aborted', error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
