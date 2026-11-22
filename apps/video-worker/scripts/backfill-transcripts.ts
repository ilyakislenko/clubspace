// Transcripts and automatic subtitles for videos the worker has not
// transcribed: every `ready` video without a VideoTranscript gets the step
// the worker's `video-chapters` job now runs — Whisper on its stored upload,
// then subtitle tracks in the spoken language and in Russian (translated by
// the chat model). Chapters are left to backfill-chapters. Idempotent — a
// transcribed video is skipped (a silent one gets an empty transcript, so it
// is not downloaded again), and a language that has a track already is not
// redone. See apps/video-worker/README.md.
//
// --video <id> (repeatable, or comma-separated): only these videos — with
// --redo-auto-subtitles, transcribed ones too.
// --redo-auto-subtitles: rebuild the automatic tracks of transcribed videos
// from their stored transcript (no download; after a better model or prompt).
// Staff's tracks are never touched.

import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { downloadVettedSource, ffmpegBinary, prisma, subtitleStore } from '../src/clients.js'
import { environment } from '../src/environment.js'
import { hasFlag, videoIdsFrom } from '../src/script-args.js'
import { llmConfigFrom, whisperConfigFrom } from '../src/speech.js'
import { processVideoText } from '../src/video-text.js'

const REDO_AUTO_SUBTITLES = hasFlag(process.argv, 'redo-auto-subtitles')
const VIDEO_IDS = videoIdsFrom(process.argv)

const llm = llmConfigFrom(environment.chaptersLlm)
const whisper = whisperConfigFrom(environment)

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

async function main() {
    if (!whisper && !REDO_AUTO_SUBTITLES) {
        throw new Error('WHISPER_MODEL_PATH is not set: nothing to transcribe with')
    }
    const videos = await prisma.video.findMany({
        where: {
            status: 'ready',
            ...(!REDO_AUTO_SUBTITLES && { transcript: { is: null } }),
            ...(VIDEO_IDS.length > 0 && { id: { in: VIDEO_IDS } }),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true, rawBucket: true, rawKey: true },
    })
    console.log(
        `[backfill-transcripts] ${videos.length} ready video(s) ${REDO_AUTO_SUBTITLES ? 'to rebuild automatic subtitles for' : 'without a transcript'}`,
    )
    console.log('[backfill-transcripts] chat model', llm ? `${llm.model} at ${llm.baseUrl}` : 'off (no translation)')

    let transcribed = 0
    let withSubtitles = 0
    const failed: Array<{ id: string; title: string; error: string }> = []
    // One at a time: each run is a Whisper pass next to a live worker.
    for (const video of videos) {
        const startedAt = Date.now()
        const workdir = await fs.mkdtemp(join(tmpdir(), `transcript-${video.id}-`))
        try {
            const run = await processVideoText(
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
                { chapters: false, redoAutoSubtitles: REDO_AUTO_SUBTITLES },
            )
            if (run.transcript?.created) transcribed += 1
            if (run.subtitles && Object.keys(run.subtitles).length > 0) withSubtitles += 1
            console.log(
                `[backfill-transcripts] ${video.id} «${video.title}»: ${JSON.stringify({ transcript: run.transcript, subtitles: run.subtitles, snapped: run.snapped })} in ${Math.round((Date.now() - startedAt) / 1000)}s`,
            )
        } catch (error) {
            failed.push({ id: video.id, title: video.title, error: errorText(error) })
            console.error(
                `[backfill-transcripts] failed ${video.id} «${video.title}»: ${errorText(error)}`,
            )
        } finally {
            await fs.rm(workdir, { recursive: true, force: true })
        }
    }

    console.log('[backfill-transcripts] summary', {
        candidates: videos.length,
        transcribed,
        // Videos whose subtitle step did something (or said why not).
        subtitled: withSubtitles,
        failed: failed.length,
    })
    if (failed.length > 0) {
        console.log('[backfill-transcripts] failed videos', failed)
        process.exitCode = 1
    }
}

main()
    .catch((error) => {
        console.error('[backfill-transcripts] aborted', error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
