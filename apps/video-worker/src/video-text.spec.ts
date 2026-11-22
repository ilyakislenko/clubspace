import { scanChapters } from './chapter-ocr'
import { SPORT_MISHEARINGS, SPORT_RUSSIAN_TERMS, SPORT_TERMS } from '@clubspace/sport-glossary'
import { chaptersFromTranscript, reviewTitles, transcribeVideo, translateCues } from './speech'
import { publishAutoSubtitle } from './subtitles'
import {
    chapterStepTimeoutMs,
    fromStoredSegments,
    loadChapterContext,
    processVideoText,
    toStoredSegments,
    type VideoTextJob,
    type VideoTextSteps,
} from './video-text'

jest.mock('./chapter-ocr', () => ({ scanChapters: jest.fn() }))
jest.mock('./speech', () => ({
    chaptersFromTranscript: jest.fn(),
    reviewTitles: jest.fn(),
    transcribeVideo: jest.fn(),
    translateCues: jest.fn(),
}))
jest.mock('./subtitles', () => ({
    ...jest.requireActual('./subtitles'),
    publishAutoSubtitle: jest.fn(),
}))

const scanChaptersMock = scanChapters as unknown as jest.Mock
const transcribeMock = transcribeVideo as unknown as jest.Mock
const chaptersFromTranscriptMock = chaptersFromTranscript as unknown as jest.Mock
const reviewTitlesMock = reviewTitles as unknown as jest.Mock
const translateMock = translateCues as unknown as jest.Mock
const publishMock = publishAutoSubtitle as unknown as jest.Mock

const LLM = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b-instruct' }
const WHISPER = { cliPath: 'whisper-cli', modelPath: '/models/ggml-small.bin' }

const CONTEXT = {
    videoTitle: 'Octopus 2.0 · Vol 3 · часть 6',
    courses: [{ title: 'Octopus 2.0', lessonTitle: null }],
}

const SOURCE = {
    inputPath: '/tmp/work/source',
    inputArgs: ['-f', 'mov'],
    durationSec: 600,
    hasAudio: true,
}

const TITLES = [
    { positionSec: 10, title: 'Attacking Far Leg from Half-Guard' },
    { positionSec: 161, title: 'Breaking Opponent to Near Side Hip' },
]

const HEARD = [
    { positionSec: 0, title: 'Introduction' },
    { positionSec: 95, title: 'Octopus Guard Entry' },
]

// Ten sentences, each a segment and a cue: enough words to be a lesson.
const SAID = {
    language: 'en',
    segments: [
        { startSec: 0, endSec: 4.25, text: 'Now we grip the collar.' },
        { startSec: 5, endSec: 9, text: 'And we pull him into the guard.' },
        ...Array.from({ length: 8 }, (_, idx) => ({
            startSec: 10 + 5 * idx,
            endSec: 14 + 5 * idx,
            text: `Step ${idx} is to keep going.`,
        })),
    ],
}
const STORED = SAID.segments.map(({ startSec, endSec, text }) => ({ from: startSec, to: endSec, text }))

// What loadChapterContext reads: the video, and its club's titles.
const clubReads = (video: unknown = VIDEO_ROW) => ({
    video: {
        findUnique: jest.fn(async () => video),
        findMany: jest.fn(async () => [
            { title: CONTEXT.videoTitle },
            { title: 'Craig Jones Shows the Perfect Kimura' },
        ]),
    },
    course: { findMany: jest.fn(async () => [{ title: 'Octopus 2.0' }]) },
    videoTimestamp: { findMany: jest.fn(async () => [{ title: 'Kimura Trap' }]) },
})

const VIDEO_ROW = {
    title: CONTEXT.videoTitle,
    workspaceId: 'ws-1',
    workspace: { type: 'GRAPPLING' },
    courses: [{ lessonTitle: null, course: { title: 'Octopus 2.0' } }],
}

interface Setup {
    /** Chapter counts the video has at each check, in order; the last repeats. */
    counts?: number[]
    job?: Partial<VideoTextJob>
    source?: Partial<typeof SOURCE>
    /** The VideoTranscript row already stored. */
    stored?: { language: string; segments: unknown } | null
    /** Languages of the subtitle tracks the video has. */
    tracks?: string[]
}

const build = ({ counts = [0], job = {}, source = {}, stored = null, tracks = [] }: Setup = {}) => {
    const queue = [...counts]
    const count = jest.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]))
    const createMany = jest.fn(async () => ({ count: 2 }))
    const tx = {
        $queryRaw: jest.fn(async () => [{ id: 'vid-1' }]),
        videoTimestamp: { count, createMany },
    }
    const updateMany = jest.fn(async () => ({ count: 1 }))
    const reads = clubReads()
    const videoTranscript = {
        findUnique: jest.fn(async () => stored),
        upsert: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
    }
    const prisma = {
        ...reads,
        videoTimestamp: { ...reads.videoTimestamp, count },
        video: { ...reads.video, updateMany },
        videoTranscript,
        videoSubtitle: {
            findMany: jest.fn(async () => tracks.map((language) => ({ language }))),
        },
        $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    }
    const loadSource = jest.fn(async () => ({ ...SOURCE, ...source }))
    const subtitleStore = { upload: jest.fn(), publicUrl: jest.fn() }
    const fullJob: VideoTextJob = {
        prisma: prisma as never,
        videoId: 'vid-1',
        ffmpegBinary: 'ffmpeg',
        workdir: '/tmp/work',
        llm: LLM,
        whisper: WHISPER,
        subtitleStore,
        loadSource,
        ...job,
    }
    const run = (steps: VideoTextSteps = { chapters: true }) => processVideoText(fullJob, steps)
    return { run, createMany, updateMany, loadSource, videoTranscript, subtitleStore }
}

const STAMP = {
    where: { id: 'vid-1' },
    data: { chaptersScannedAt: expect.any(Date) },
}

beforeEach(() => {
    scanChaptersMock.mockReset().mockResolvedValue({ chapters: [], candidates: 0, coarseFrames: 200 })
    transcribeMock.mockReset().mockResolvedValue({ transcript: SAID, snaps: [] })
    chaptersFromTranscriptMock.mockReset().mockResolvedValue({ chapters: HEARD, snaps: [] })
    // The model keeps every title unless a test says otherwise.
    reviewTitlesMock.mockReset().mockImplementation(async (_llm, _context, chapters) => chapters)
    translateMock
        .mockReset()
        .mockImplementation(async ({ cues }) =>
            cues.map((cue: { text: string }) => ({ ...cue, text: `RU ${cue.text}` })),
        )
    publishMock.mockReset().mockResolvedValue('created')
})

describe('chapterStepTimeoutMs', () => {
    it('allows a second per second of video, within 5 minutes and an hour', () => {
        expect(chapterStepTimeoutMs(600)).toBe(600_000)
        expect(chapterStepTimeoutMs(30)).toBe(5 * 60_000)
        expect(chapterStepTimeoutMs(4 * 60 * 60)).toBe(60 * 60_000)
        expect(chapterStepTimeoutMs(null)).toBe(30 * 60_000)
    })
})

describe('loadChapterContext', () => {
    it('reads the video’s titles, and spells by the sport’s terms and the club’s', async () => {
        const prisma = clubReads()
        const { context, glossary, terms } = await loadChapterContext(prisma as never, 'vid-1')
        expect(context).toEqual(CONTEXT)
        expect(glossary.sportTerms).toBe(SPORT_TERMS.GRAPPLING)
        expect(glossary.misheard).toEqual(new Map(Object.entries(SPORT_MISHEARINGS.GRAPPLING)))
        expect(terms).toBe(SPORT_RUSSIAN_TERMS.GRAPPLING)
        const canonical = glossary.terms.map((term) => term.canonical)
        // The coach's chapter title and the club's uncommon words.
        expect(canonical).toEqual(expect.arrayContaining(['Kimura Trap', 'Octopus', 'Craig']))
        expect(prisma.video.findUnique.mock.calls[0]).toEqual([
            {
                where: { id: 'vid-1' },
                select: {
                    title: true,
                    workspaceId: true,
                    workspace: { select: { type: true } },
                    courses: { select: { lessonTitle: true, course: { select: { title: true } } } },
                },
            },
        ])
        expect(prisma.course.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws-1' },
            select: { title: true },
        })
        expect(prisma.video.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'ws-1' },
            select: { title: true },
        })
        // Only what staff wrote: automatic chapters would confirm their own misreadings.
        expect(prisma.videoTimestamp.findMany).toHaveBeenCalledWith({
            where: { source: 'manual', video: { workspaceId: 'ws-1' } },
            select: { title: true },
        })
    })

    it('has empty titles and no glossary for a video that is gone', async () => {
        const prisma = clubReads(null)
        await expect(loadChapterContext(prisma as never, 'vid-1')).resolves.toEqual({
            context: { videoTitle: '', courses: [] },
            glossary: { sportTerms: [], terms: [], words: new Set(), misheard: new Map() },
            terms: [],
        })
        expect(prisma.course.findMany).not.toHaveBeenCalled()
    })
})

describe('stored segments', () => {
    it('are kept in seconds to the millisecond and read back, skipping anything malformed', () => {
        expect(toStoredSegments([{ startSec: 1.23456, endSec: 2.0004, text: 'Hi.' }])).toEqual([
            { from: 1.235, to: 2, text: 'Hi.' },
        ])
        expect(
            fromStoredSegments([...STORED, null, 'x', { from: '1', to: 2, text: 'no' }]),
        ).toEqual(SAID.segments)
        expect(fromStoredSegments({ segments: [] })).toEqual([])
    })
})

describe('processVideoText: transcript', () => {
    it('transcribes the video once, stores it, and reports what it snapped', async () => {
        transcribeMock.mockResolvedValue({
            transcript: SAID,
            snaps: [
                { from: 'camorra', to: 'kimura' },
                { from: 'camorra', to: 'kimura' },
            ],
        })
        const { run, videoTranscript, loadSource } = build()
        await expect(run()).resolves.toMatchObject({
            transcript: { language: 'en', segments: 10, created: true, ms: expect.any(Number) },
            snapped: ['camorra→kimura ×2'],
        })
        expect(transcribeMock).toHaveBeenCalledTimes(1)
        expect(transcribeMock).toHaveBeenCalledWith({
            whisper: WHISPER,
            context: CONTEXT,
            glossary: expect.objectContaining({ sportTerms: SPORT_TERMS.GRAPPLING }),
            ffmpegBinary: 'ffmpeg',
            inputArgs: ['-f', 'mov'],
            inputPath: '/tmp/work/source',
            workdir: '/tmp/work',
            timeoutMs: 600_000,
        })
        expect(videoTranscript.upsert).toHaveBeenCalledWith({
            where: { videoId: 'vid-1' },
            create: { videoId: 'vid-1', language: 'en', segments: STORED },
            update: { language: 'en', segments: STORED },
        })
        // Subtitles and chapters share one download.
        expect(loadSource).toHaveBeenCalledTimes(1)
    })

    it('reads a stored transcript back instead of downloading the video', async () => {
        const { run, loadSource, videoTranscript } = build({
            stored: { language: 'en', segments: STORED },
            tracks: ['en', 'ru'],
        })
        await expect(run({ chapters: false })).resolves.toEqual({
            transcript: { language: 'en', segments: 10, created: false, ms: 0 },
            subtitles: {},
        })
        expect(loadSource).not.toHaveBeenCalled()
        expect(transcribeMock).not.toHaveBeenCalled()
        expect(videoTranscript.upsert).not.toHaveBeenCalled()
    })

    it('stores a silent video as transcribed, in no language', async () => {
        const { run, videoTranscript } = build({ source: { hasAudio: false } })
        await expect(run({ chapters: false })).resolves.toEqual({
            transcript: { language: null, segments: 0, created: true, ms: expect.any(Number) },
            subtitles: {},
        })
        expect(transcribeMock).not.toHaveBeenCalled()
        expect(videoTranscript.upsert.mock.calls[0]).toMatchObject([
            { create: { language: 'und', segments: [] } },
        ])

        const again = build({ stored: { language: 'und', segments: [] } })
        await expect(again.run({ chapters: false })).resolves.toMatchObject({
            transcript: { language: null, segments: 0, created: false },
            subtitles: {},
        })
    })

    it('has no transcript without Whisper', async () => {
        const { run, loadSource } = build({ job: { whisper: null } })
        await expect(run({ chapters: false })).resolves.toEqual({ subtitles: {} })
        expect(loadSource).not.toHaveBeenCalled()
    })
})

describe('processVideoText: subtitles', () => {
    it('publishes the spoken language and a Russian translation, kept for search too', async () => {
        const { run, videoTranscript, subtitleStore } = build()
        await expect(run({ chapters: false })).resolves.toMatchObject({
            subtitles: { en: 'created', ru: 'created' },
        })
        const [english, russian] = publishMock.mock.calls
        expect(english.slice(0, 3)).toEqual([expect.anything(), subtitleStore, 'vid-1'])
        expect(english[3]).toEqual({
            language: 'en',
            vtt: expect.stringContaining('00:00:00.000 --> 00:00:04.250\nNow we grip the collar.'),
            defaultIfNone: false,
        })
        expect(russian[3]).toEqual({
            language: 'ru',
            vtt: expect.stringContaining('00:00:00.000 --> 00:00:04.250\nRU Now we grip the collar.'),
            defaultIfNone: true,
        })
        expect(translateMock).toHaveBeenCalledWith({
            llm: LLM,
            context: CONTEXT,
            cues: SAID.segments.map((segment, unit) => ({ unit, ...segment })),
            terms: SPORT_RUSSIAN_TERMS.GRAPPLING,
        })
        expect(videoTranscript.update).toHaveBeenCalledWith({
            where: { videoId: 'vid-1' },
            data: {
                translations: {
                    ru: STORED.map((segment) => ({ ...segment, text: `RU ${segment.text}` })),
                },
            },
        })
    })

    it('needs no translation for Russian speech', async () => {
        transcribeMock.mockResolvedValue({ transcript: { ...SAID, language: 'ru' }, snaps: [] })
        const { run } = build()
        await expect(run({ chapters: false })).resolves.toMatchObject({
            subtitles: { ru: 'created' },
        })
        expect(publishMock).toHaveBeenCalledTimes(1)
        expect(publishMock.mock.calls[0][3]).toMatchObject({ language: 'ru', defaultIfNone: true })
        expect(translateMock).not.toHaveBeenCalled()
    })

    it('leaves the tracks a video has, unless asked to redo them', async () => {
        const { run } = build({ tracks: ['en'] })
        await expect(run({ chapters: false })).resolves.toMatchObject({
            subtitles: { ru: 'created' },
        })
        expect(publishMock.mock.calls.map((call) => call[3].language)).toEqual(['ru'])

        publishMock.mockReset().mockResolvedValueOnce('replaced').mockResolvedValueOnce('kept')
        const redo = build({ tracks: ['en', 'ru'] })
        await expect(redo.run({ chapters: false, redoAutoSubtitles: true })).resolves.toMatchObject({
            subtitles: { en: 'replaced', ru: 'kept' },
        })
    })

    it('says why there is no Russian track', async () => {
        const noModel = build({ job: { llm: null } })
        await expect(noModel.run({ chapters: false })).resolves.toMatchObject({
            subtitles: { en: 'created', ru: 'no chat model to translate' },
        })

        translateMock.mockResolvedValue(null)
        const unusable = build()
        await expect(unusable.run({ chapters: false })).resolves.toMatchObject({
            subtitles: { en: 'created', ru: 'translation unusable' },
        })
        expect(unusable.videoTranscript.update).not.toHaveBeenCalled()

        translateMock.mockRejectedValue(new Error('chapters LLM answered HTTP 402'))
        const failed = build()
        await expect(failed.run({ chapters: false })).resolves.toMatchObject({
            subtitles: { en: 'created', ru: 'failed: chapters LLM answered HTTP 402' },
        })
        expect(publishMock).toHaveBeenCalledTimes(3)
    })

    it('never fails the job over subtitles', async () => {
        publishMock.mockRejectedValue('storage is down')
        const { run } = build()
        await expect(run()).resolves.toMatchObject({
            subtitles: { error: 'storage is down' },
            chapters: { outcome: 'created', source: 'speech' },
        })
    })
})

describe('processVideoText: chapters', () => {
    it('only stamps a video that has chapters, without downloading it', async () => {
        const { run, loadSource, updateMany } = build({
            counts: [3],
            stored: { language: 'en', segments: STORED },
            tracks: ['en', 'ru'],
        })
        await expect(run()).resolves.toMatchObject({ chapters: { outcome: 'kept', chapters: 0 } })
        expect(loadSource).not.toHaveBeenCalled()
        expect(scanChaptersMock).not.toHaveBeenCalled()
        expect(updateMany).toHaveBeenCalledWith(STAMP)
    })

    it('stores the titles the model keeps, names none from speech, and stamps the video', async () => {
        scanChaptersMock.mockResolvedValue({ chapters: TITLES, candidates: 2, coarseFrames: 381 })
        const { run, createMany, updateMany } = build()
        await expect(run()).resolves.toMatchObject({
            chapters: {
                outcome: 'created',
                source: 'ocr',
                chapters: 2,
                ocr: { candidates: 2, frames: 381, reviewed: '2 of 2', ms: expect.any(Number) },
            },
        })
        expect(scanChaptersMock).toHaveBeenCalledWith({
            binary: 'ffmpeg',
            inputArgs: ['-f', 'mov'],
            inputPath: '/tmp/work/source',
            workdir: '/tmp/work',
            timeoutMs: 600_000,
        })
        expect(reviewTitlesMock).toHaveBeenCalledWith(LLM, CONTEXT, TITLES)
        expect(createMany.mock.calls[0]).toEqual([
            { data: TITLES.map((t) => ({ videoId: 'vid-1', ...t, source: 'ocr' })) },
        ])
        expect(chaptersFromTranscriptMock).not.toHaveBeenCalled()
        expect(updateMany).toHaveBeenCalledWith(STAMP)
    })

    it('stores OCR titles unreviewed without a chat model', async () => {
        scanChaptersMock.mockResolvedValue({ chapters: TITLES, candidates: 2, coarseFrames: 381 })
        const { run } = build({ job: { llm: null } })
        await expect(run()).resolves.toMatchObject({
            chapters: { outcome: 'created', source: 'ocr', ocr: { candidates: 2, frames: 381 } },
        })
        expect(reviewTitlesMock).not.toHaveBeenCalled()
    })

    it('puts misread technique names right before the model sees them, and says so', async () => {
        scanChaptersMock.mockResolvedValue({
            chapters: [
                { positionSec: 211, title: 'Komura Grip' },
                { positionSec: 241, title: 'Breaking Komura Grip' },
                { positionSec: 300, title: 'Transition to Inside Sankakuh' },
            ],
            candidates: 3,
            coarseFrames: 200,
        })
        const { run, createMany } = build({ tracks: ['en', 'ru'] })
        await expect(run()).resolves.toMatchObject({
            chapters: { outcome: 'created', source: 'ocr' },
            snapped: ['Komura→Kimura ×2', 'Inside Sankakuh→Inside Sankaku'],
        })
        const titles = ['Kimura Grip', 'Breaking Kimura Grip', 'Transition to Inside Sankaku']
        expect(reviewTitlesMock.mock.calls[0][2].map((c: { title: string }) => c.title)).toEqual(titles)
        expect(createMany.mock.calls[0][0].data.map((c: { title: string }) => c.title)).toEqual(titles)
    })

    it('names chapters from the transcript when the model rejects the titles down to one', async () => {
        scanChaptersMock.mockResolvedValue({ chapters: TITLES, candidates: 2, coarseFrames: 381 })
        reviewTitlesMock.mockResolvedValue(TITLES.slice(0, 1))
        chaptersFromTranscriptMock.mockResolvedValue({
            chapters: HEARD,
            snaps: [{ from: 'Octopuss', to: 'Octopus' }],
        })
        const { run, createMany } = build()
        await expect(run()).resolves.toMatchObject({
            chapters: { outcome: 'created', source: 'speech', ocr: { reviewed: '1 of 2' } },
            snapped: ['Octopuss→Octopus'],
        })
        expect(createMany.mock.calls[0][0].data[0].source).toBe('speech')
    })

    it('falls back to what the instructor says, from the one transcript', async () => {
        scanChaptersMock.mockResolvedValue({
            chapters: [],
            candidates: 0,
            coarseFrames: 200,
            textHeavy: true,
        })
        const { run, createMany } = build()
        await expect(run()).resolves.toMatchObject({
            chapters: {
                outcome: 'created',
                source: 'speech',
                chapters: 2,
                ocr: { candidates: 0, frames: 200, textHeavy: true, ms: expect.any(Number) },
                speech: { ms: expect.any(Number) },
            },
        })
        expect(transcribeMock).toHaveBeenCalledTimes(1)
        expect(chaptersFromTranscriptMock).toHaveBeenCalledWith({
            llm: LLM,
            transcript: SAID,
            context: CONTEXT,
            glossary: expect.objectContaining({ sportTerms: SPORT_TERMS.GRAPPLING }),
            durationSec: 600,
        })
        expect(createMany.mock.calls[0]).toEqual([
            { data: HEARD.map((t) => ({ videoId: 'vid-1', ...t, source: 'speech' })) },
        ])
    })

    it('reports why speech gave no chapters and stamps the video', async () => {
        chaptersFromTranscriptMock.mockResolvedValue({ chapters: [], rejected: 'no speech', snaps: [] })
        const { run, createMany, updateMany } = build()
        await expect(run()).resolves.toMatchObject({
            chapters: { outcome: 'none', chapters: 0, speech: { rejected: 'no speech' } },
        })
        expect(createMany).not.toHaveBeenCalled()
        expect(updateMany).toHaveBeenCalledWith(STAMP)
    })

    it('names no chapters from speech without a chat model or a transcript', async () => {
        for (const job of [{ llm: null }, { whisper: null }]) {
            const { run } = build({ job })
            await expect(run()).resolves.toMatchObject({
                chapters: {
                    outcome: 'none',
                    chapters: 0,
                    ocr: { candidates: 0, frames: 200, ms: expect.any(Number) },
                },
            })
        }
        expect(chaptersFromTranscriptMock).not.toHaveBeenCalled()
    })

    it('does not name chapters once someone added some during the OCR pass', async () => {
        const { run } = build({ counts: [0, 2] })
        await expect(run()).resolves.toMatchObject({ chapters: { outcome: 'kept', chapters: 0 } })
        expect(chaptersFromTranscriptMock).not.toHaveBeenCalled()
    })

    it('leaves the video unscanned when a step fails, so it is tried again', async () => {
        chaptersFromTranscriptMock.mockRejectedValue(new Error('chapters LLM answered HTTP 402: no credits'))
        const { run, createMany, updateMany } = build()
        await expect(run()).rejects.toThrow('HTTP 402')
        expect(createMany).not.toHaveBeenCalled()
        expect(updateMany).not.toHaveBeenCalled()
    })
})
