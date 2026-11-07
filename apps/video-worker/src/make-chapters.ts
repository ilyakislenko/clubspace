import type { PrismaClient } from '@clubspace/prisma-client'

import { scanChapters } from './chapter-ocr.js'
import { type Chapter, type ChapterSource, publishChapters } from './chapters.js'
import {
    type LlmConfig,
    reviewTitles,
    scanSpeechChapters,
    type SpeechConfig,
} from './speech.js'
import type { ChapterContext } from './speech-chapters.js'

// The chapter chain, run by the worker's `video-chapters` job and by the
// backfill: titles on screen first — vetted by the chat model when one is
// configured — then, only when no titles hold up and the video still has no
// chapters, what the instructor says. Whatever is found is stored at once,
// and only on a video without chapters. A finished run stamps
// Video.chaptersScannedAt, so a video is scanned once: chapters a coach
// deletes later stay deleted.

/** The video file to read, downloaded and vetted like the transcode does. */
export interface ChapterSourceFile {
    inputPath: string
    // Input options placed before `-i`: the probe's whitelists and demuxer.
    inputArgs: string[]
    durationSec: number | null
    hasAudio: boolean
}

export interface ChapterJob {
    prisma: Pick<PrismaClient, '$transaction' | 'videoTimestamp' | 'video'>
    videoId: string
    ffmpegBinary: string
    workdir: string
    /** Null: OCR titles are stored unreviewed (see llmConfigFrom). */
    llm: LlmConfig | null
    /** Null: the speech step is off (see speechConfigFrom). */
    speech: SpeechConfig | null
    /** Fetches the source; only called when there is something to look for. */
    loadSource: () => Promise<ChapterSourceFile>
}

export interface ChapterRun {
    outcome: 'created' | 'kept' | 'none'
    source?: ChapterSource
    chapters: number
    ocr?: {
        candidates: number
        frames: number
        textHeavy?: boolean
        /** Titles the model kept, of those OCR found. */
        reviewed?: string
        ms: number
    }
    speech?: { language: string | null; segments: number; rejected?: string; ms: number }
}

// A chapter list needs two.
const MIN_CHAPTERS = 2

// One ffmpeg or whisper-cli run: a second per second of video (a full decode,
// or speech recognition on a few CPU cores, takes well under that), within
// 5 minutes to an hour; half an hour when the length is unknown.
export const chapterStepTimeoutMs = (durationSec: number | null) =>
    Math.min(60 * 60_000, Math.max(5 * 60_000, (durationSec ?? 30 * 60) * 1000))

/** The video's own title and its courses': context for the model. */
export const loadChapterContext = async (
    prisma: Pick<PrismaClient, 'video'>,
    videoId: string,
): Promise<ChapterContext> => {
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            title: true,
            courses: { select: { lessonTitle: true, course: { select: { title: true } } } },
        },
    })
    return {
        videoTitle: video?.title ?? '',
        courses: (video?.courses ?? []).map((entry) => ({
            title: entry.course.title,
            lessonTitle: entry.lessonTitle,
        })),
    }
}

export const makeChapters = async (job: ChapterJob): Promise<ChapterRun> => {
    const { prisma, videoId } = job
    // Checked before each pass so a video that has chapters (a re-run, or a
    // coach adding some meanwhile) is not read for nothing. publishChapters
    // re-checks under a lock.
    const hasChapters = async () =>
        (await prisma.videoTimestamp.count({ where: { videoId } })) > 0
    // Not reached when a step throws: the video stays unscanned and the
    // backfill tries it again.
    const finish = async (run: ChapterRun) => {
        await prisma.video.updateMany({
            where: { id: videoId },
            data: { chaptersScannedAt: new Date() },
        })
        return run
    }
    const publish = async (chapters: Chapter[], source: ChapterSource) => ({
        outcome: await publishChapters(prisma, videoId, chapters, source),
        source,
        chapters: chapters.length,
    })

    if (await hasChapters()) return finish({ outcome: 'kept', chapters: 0 })

    const file = await job.loadSource()
    const timeoutMs = chapterStepTimeoutMs(file.durationSec)
    const context = job.llm ? await loadChapterContext(prisma, videoId) : null
    let startedAt = Date.now()
    const scan = await scanChapters({
        binary: job.ffmpegBinary,
        inputArgs: file.inputArgs,
        inputPath: file.inputPath,
        workdir: job.workdir,
        timeoutMs,
    })
    let titles = scan.chapters
    let reviewed: string | undefined
    if (titles.length > 0 && job.llm && context) {
        titles = await reviewTitles(job.llm, context, titles)
        reviewed = `${titles.length} of ${scan.chapters.length}`
    }
    const ocr = {
        candidates: scan.candidates,
        frames: scan.coarseFrames,
        ...(scan.textHeavy && { textHeavy: true }),
        ...(reviewed && { reviewed }),
        ms: Date.now() - startedAt,
    }
    if (titles.length >= MIN_CHAPTERS) return finish({ ...(await publish(titles, 'ocr')), ocr })

    if (!job.speech || !context || !file.hasAudio) {
        return finish({ outcome: 'none', chapters: 0, ocr })
    }
    if (await hasChapters()) return finish({ outcome: 'kept', chapters: 0, ocr })

    startedAt = Date.now()
    const heard = await scanSpeechChapters({
        config: job.speech,
        context,
        ffmpegBinary: job.ffmpegBinary,
        inputArgs: file.inputArgs,
        inputPath: file.inputPath,
        durationSec: file.durationSec,
        workdir: job.workdir,
        timeoutMs,
    })
    const speech = {
        language: heard.language,
        segments: heard.segments,
        ...(heard.rejected && { rejected: heard.rejected }),
        ms: Date.now() - startedAt,
    }
    if (heard.chapters.length === 0) return finish({ outcome: 'none', chapters: 0, ocr, speech })
    return finish({ ...(await publish(heard.chapters, 'speech')), ocr, speech })
}
