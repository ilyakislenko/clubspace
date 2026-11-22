import type { PrismaClient } from '@clubspace/prisma-client'

import { scanChapters } from './chapter-ocr.js'
import { type Chapter, type ChapterSource, publishChapters } from './chapters.js'
import {
    type RussianTerm,
    SPORT_MISHEARINGS,
    SPORT_RUSSIAN_TERMS,
    SPORT_TERMS,
} from '@clubspace/sport-glossary'
import {
    chaptersFromTranscript,
    type LlmConfig,
    reviewTitles,
    transcribeVideo,
    translateCues,
    type WhisperConfig,
} from './speech.js'
import {
    type ChapterContext,
    hasSpeech,
    type Transcript,
    type TranscriptSegment,
} from './speech-chapters.js'
import { buildCues, publishAutoSubtitle, type SubtitleStore, toVtt } from './subtitles.js'
import {
    buildGlossary,
    clubTerms,
    describeSnaps,
    type Glossary,
    type Snap,
    snapTerms,
} from './term-snap.js'

// Everything the worker derives from what a video shows and says, run by its
// `video-chapters` job after a transcode and by the backfills:
//
// - The transcript (Whisper), stored once per video as VideoTranscript.
// - Automatic subtitles from it: the spoken language and a Russian
//   translation, as 'auto' VideoSubtitle rows beside staff's tracks.
// - The chapter chain: titles on screen first — vetted by the chat model when
//   one is configured — then, only when no titles hold up and the video still
//   has no chapters, chapters named from the transcript. Stored only on a
//   video without chapters; a finished run stamps Video.chaptersScannedAt, so
//   a video is scanned once and chapters a coach deletes stay deleted.
//
// The source is downloaded at most once, and only when a step needs it.

/** The video file to read, downloaded and vetted like the transcode does. */
export interface ChapterSourceFile {
    inputPath: string
    // Input options placed before `-i`: the probe's whitelists and demuxer.
    inputArgs: string[]
    durationSec: number | null
    hasAudio: boolean
}

export interface VideoTextJob {
    prisma: Pick<
        PrismaClient,
        '$transaction' | 'videoTimestamp' | 'video' | 'course' | 'videoTranscript' | 'videoSubtitle'
    >
    videoId: string
    ffmpegBinary: string
    workdir: string
    /** Null: OCR titles go unreviewed, no speech chapters, no translation. */
    llm: LlmConfig | null
    /** Null: no transcript, so no subtitles or speech chapters. */
    whisper: WhisperConfig | null
    subtitleStore: SubtitleStore
    /** Fetches the source; only called when a step needs it. */
    loadSource: () => Promise<ChapterSourceFile>
}

export interface VideoTextSteps {
    /** Run the chapter chain (the backfill of transcripts does not). */
    chapters: boolean
    /** Rebuild automatic subtitle tracks that exist already. */
    redoAutoSubtitles?: boolean
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
    speech?: { rejected?: string; ms: number }
}

export interface VideoTextRun {
    transcript?: {
        language: string | null
        segments: number
        /** Made by this run, not read back. */
        created: boolean
        ms: number
    }
    /** Per language: 'created', 'replaced', 'kept' (staff's), or why not. */
    subtitles?: Record<string, string>
    chapters?: ChapterRun
    /** Misread terms snapped to the glossary: «Komura→Kimura ×2». */
    snapped?: string[]
}

// A chapter list needs two.
const MIN_CHAPTERS = 2
// Transcript language when Whisper names none.
const UNKNOWN_LANGUAGE = 'und'
// The members' language: every video with speech gets a track in it.
const MEMBERS_LANGUAGE = 'ru'

// One ffmpeg or whisper-cli run: a second per second of video (a full decode,
// or speech recognition on a few CPU cores, takes well under that), within
// 5 minutes to an hour; half an hour when the length is unknown.
export const chapterStepTimeoutMs = (durationSec: number | null) =>
    Math.min(60 * 60_000, Math.max(5 * 60_000, (durationSec ?? 30 * 60) * 1000))

/**
 * The video's own title and its courses' (context for the model), the
 * glossary its text is spelled by — the sport's terms and known mishearings
 * for the club's WorkspaceType, plus the club's own words: its course and
 * video titles and the chapter titles its staff wrote — and how members say
 * the sport's terms in Russian.
 */
export const loadChapterContext = async (
    prisma: Pick<PrismaClient, 'video' | 'course' | 'videoTimestamp'>,
    videoId: string,
): Promise<{ context: ChapterContext; glossary: Glossary; terms: readonly RussianTerm[] }> => {
    const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: {
            title: true,
            workspaceId: true,
            workspace: { select: { type: true } },
            courses: { select: { lessonTitle: true, course: { select: { title: true } } } },
        },
    })
    const context = {
        videoTitle: video?.title ?? '',
        courses: (video?.courses ?? []).map((entry) => ({
            title: entry.course.title,
            lessonTitle: entry.lessonTitle,
        })),
    }
    if (!video) return { context, glossary: buildGlossary([]), terms: [] }

    const { workspaceId } = video
    const [courses, videos, manual] = await Promise.all([
        prisma.course.findMany({ where: { workspaceId }, select: { title: true } }),
        prisma.video.findMany({ where: { workspaceId }, select: { title: true } }),
        prisma.videoTimestamp.findMany({
            where: { source: 'manual', video: { workspaceId } },
            select: { title: true },
        }),
    ])
    const titles = [...courses, ...videos].map((row) => row.title)
    const sport = video.workspace.type
    return {
        context,
        glossary: buildGlossary(
            SPORT_TERMS[sport],
            clubTerms(
                titles,
                manual.map((row) => row.title),
            ),
            SPORT_MISHEARINGS[sport],
        ),
        terms: SPORT_RUSSIAN_TERMS[sport],
    }
}

/** Stored segments: `{ from, to, text }` in seconds, to the millisecond. */
export const toStoredSegments = (segments: readonly TranscriptSegment[]) =>
    segments.map((segment) => ({
        from: Math.round(segment.startSec * 1000) / 1000,
        to: Math.round(segment.endSec * 1000) / 1000,
        text: segment.text,
    }))

/** Stored segments read back; anything malformed is skipped. */
export const fromStoredSegments = (stored: unknown): TranscriptSegment[] =>
    (Array.isArray(stored) ? stored : []).flatMap((item: unknown) => {
        if (!item || typeof item !== 'object') return []
        const { from, to, text } = item as Record<string, unknown>
        return typeof from === 'number' && typeof to === 'number' && typeof text === 'string'
            ? [{ startSec: from, endSec: to, text }]
            : []
    })

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const processVideoText = async (
    job: VideoTextJob,
    steps: VideoTextSteps,
): Promise<VideoTextRun> => {
    const { prisma, videoId } = job
    const run: VideoTextRun = {}
    const snaps: Snap[] = []

    // Each loaded once, on first need.
    let file: Promise<ChapterSourceFile> | undefined
    const source = () => (file ??= job.loadSource())
    let setting: ReturnType<typeof loadChapterContext> | undefined
    const loadSetting = () => (setting ??= loadChapterContext(prisma, videoId))
    let heard: Promise<Transcript | null> | undefined
    const transcript = () => (heard ??= readOrTranscribe())

    async function readOrTranscribe(): Promise<Transcript | null> {
        const row = await prisma.videoTranscript.findUnique({
            where: { videoId },
            select: { language: true, segments: true },
        })
        if (row) {
            const language = row.language === UNKNOWN_LANGUAGE ? null : row.language
            const segments = fromStoredSegments(row.segments)
            run.transcript = { language, segments: segments.length, created: false, ms: 0 }
            return { language, segments }
        }
        if (!job.whisper) return null

        const startedAt = Date.now()
        const video = await source()
        let made: Transcript = { language: null, segments: [] }
        if (video.hasAudio) {
            const { context, glossary } = await loadSetting()
            const result = await transcribeVideo({
                whisper: job.whisper,
                context,
                glossary,
                ffmpegBinary: job.ffmpegBinary,
                inputArgs: video.inputArgs,
                inputPath: video.inputPath,
                workdir: job.workdir,
                timeoutMs: chapterStepTimeoutMs(video.durationSec),
            })
            made = result.transcript
            snaps.push(...result.snaps)
        }
        // Stored even when silent: the video was transcribed, and is not
        // downloaded again for it.
        const data = {
            language: made.language ?? UNKNOWN_LANGUAGE,
            segments: toStoredSegments(made.segments),
        }
        await prisma.videoTranscript.upsert({
            where: { videoId },
            create: { videoId, ...data },
            update: data,
        })
        run.transcript = {
            language: made.language,
            segments: made.segments.length,
            created: true,
            ms: Date.now() - startedAt,
        }
        return made
    }

    run.subtitles = await makeSubtitles()
    if (steps.chapters) run.chapters = await makeChapters()
    if (snaps.length > 0) run.snapped = describeSnaps(snaps)
    return run

    // Never throws: subtitles are a convenience; what failed is reported.
    async function makeSubtitles(): Promise<Record<string, string>> {
        try {
            const said = await transcript()
            if (!said?.language || !hasSpeech(said)) return {}
            const existing = await prisma.videoSubtitle.findMany({
                where: { videoId },
                select: { language: true },
            })
            const missing = (language: string) =>
                steps.redoAutoSubtitles === true ||
                !existing.some((row) => row.language === language)
            const cues = buildCues(said.segments)
            const result: Record<string, string> = {}
            if (missing(said.language)) {
                result[said.language] = await publishAutoSubtitle(
                    prisma,
                    job.subtitleStore,
                    videoId,
                    {
                        language: said.language,
                        vtt: toVtt(cues),
                        defaultIfNone: said.language === MEMBERS_LANGUAGE,
                    },
                )
            }
            if (said.language === MEMBERS_LANGUAGE || !missing(MEMBERS_LANGUAGE)) return result
            if (!job.llm) return { ...result, [MEMBERS_LANGUAGE]: 'no chat model to translate' }
            try {
                const { context, terms } = await loadSetting()
                const translated = await translateCues({ llm: job.llm, context, cues, terms })
                if (!translated) {
                    result[MEMBERS_LANGUAGE] = 'translation unusable'
                    return result
                }
                // Kept with the transcript too: search finds Russian words.
                await prisma.videoTranscript.update({
                    where: { videoId },
                    data: {
                        translations: { [MEMBERS_LANGUAGE]: toStoredSegments(translated) },
                    },
                })
                result[MEMBERS_LANGUAGE] = await publishAutoSubtitle(
                    prisma,
                    job.subtitleStore,
                    videoId,
                    { language: MEMBERS_LANGUAGE, vtt: toVtt(translated), defaultIfNone: true },
                )
            } catch (error) {
                result[MEMBERS_LANGUAGE] = `failed: ${errorText(error)}`
            }
            return result
        } catch (error) {
            return { error: errorText(error) }
        }
    }

    async function makeChapters(): Promise<ChapterRun> {
        // Checked before each pass so a video that has chapters (a re-run, or
        // a coach adding some meanwhile) is not read for nothing.
        // publishChapters re-checks under a lock.
        const hasChapters = async () =>
            (await prisma.videoTimestamp.count({ where: { videoId } })) > 0
        // Not reached when a step throws: the video stays unscanned and the
        // backfill tries it again.
        const finish = async (chapterRun: ChapterRun) => {
            await prisma.video.updateMany({
                where: { id: videoId },
                data: { chaptersScannedAt: new Date() },
            })
            return chapterRun
        }
        const publish = async (chapters: Chapter[], chapterSource: ChapterSource) => ({
            outcome: await publishChapters(prisma, videoId, chapters, chapterSource),
            source: chapterSource,
            chapters: chapters.length,
        })

        if (await hasChapters()) return finish({ outcome: 'kept', chapters: 0 })

        const video = await source()
        const { context, glossary } = await loadSetting()
        let startedAt = Date.now()
        const scan = await scanChapters({
            binary: job.ffmpegBinary,
            inputArgs: video.inputArgs,
            inputPath: video.inputPath,
            workdir: job.workdir,
            timeoutMs: chapterStepTimeoutMs(video.durationSec),
        })
        // Misread technique names put right («Inside Sankakuh»), before the
        // model reviews them.
        let titles = scan.chapters.map((chapter) => {
            const snapped = snapTerms(chapter.title, glossary)
            snaps.push(...snapped.snaps)
            return { ...chapter, title: snapped.text }
        })
        let reviewed: string | undefined
        if (titles.length > 0 && job.llm) {
            const kept = await reviewTitles(job.llm, context, titles)
            reviewed = `${kept.length} of ${titles.length}`
            titles = kept
        }
        const ocr = {
            candidates: scan.candidates,
            frames: scan.coarseFrames,
            ...(scan.textHeavy && { textHeavy: true }),
            ...(reviewed && { reviewed }),
            ms: Date.now() - startedAt,
        }
        if (titles.length >= MIN_CHAPTERS) return finish({ ...(await publish(titles, 'ocr')), ocr })

        if (!job.llm) return finish({ outcome: 'none', chapters: 0, ocr })
        const said = await transcript()
        if (!said) return finish({ outcome: 'none', chapters: 0, ocr })
        if (await hasChapters()) return finish({ outcome: 'kept', chapters: 0, ocr })

        startedAt = Date.now()
        const named = await chaptersFromTranscript({
            llm: job.llm,
            transcript: said,
            context,
            glossary,
            durationSec: video.durationSec,
        })
        snaps.push(...named.snaps)
        const speech = {
            ...(named.rejected && { rejected: named.rejected }),
            ms: Date.now() - startedAt,
        }
        if (named.chapters.length === 0) return finish({ outcome: 'none', chapters: 0, ocr, speech })
        return finish({ ...(await publish(named.chapters, 'speech')), ocr, speech })
    }
}
