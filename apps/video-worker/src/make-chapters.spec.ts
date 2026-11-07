import { scanChapters } from './chapter-ocr'
import {
    chapterStepTimeoutMs,
    loadChapterContext,
    makeChapters,
    type ChapterJob,
} from './make-chapters'
import { reviewTitles, scanSpeechChapters } from './speech'

jest.mock('./chapter-ocr', () => ({ scanChapters: jest.fn() }))
jest.mock('./speech', () => ({ scanSpeechChapters: jest.fn(), reviewTitles: jest.fn() }))

const scanChaptersMock = scanChapters as unknown as jest.Mock
const scanSpeechMock = scanSpeechChapters as unknown as jest.Mock
const reviewTitlesMock = reviewTitles as unknown as jest.Mock

const LLM = { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b-instruct' }

const SPEECH = {
    whisperCliPath: 'whisper-cli',
    whisperModelPath: '/models/ggml-small.bin',
    llm: LLM,
}

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

// Chapter counts the video has at each check, in order; the last repeats.
const build = (
    counts: number[] = [0],
    overrides: Partial<ChapterJob> = {},
    source: Partial<typeof SOURCE> = {},
) => {
    const queue = [...counts]
    const count = jest.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]))
    const createMany = jest.fn(async () => ({ count: 2 }))
    const tx = {
        $queryRaw: jest.fn(async () => [{ id: 'vid-1' }]),
        videoTimestamp: { count, createMany },
    }
    const updateMany = jest.fn(async () => ({ count: 1 }))
    const prisma = {
        videoTimestamp: { count },
        video: {
            updateMany,
            findUnique: jest.fn(async () => ({
                title: CONTEXT.videoTitle,
                courses: [{ lessonTitle: null, course: { title: 'Octopus 2.0' } }],
            })),
        },
        $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    }
    const loadSource = jest.fn(async () => ({ ...SOURCE, ...source }))
    const job: ChapterJob = {
        prisma: prisma as never,
        videoId: 'vid-1',
        ffmpegBinary: 'ffmpeg',
        workdir: '/tmp/work',
        llm: LLM,
        speech: SPEECH,
        loadSource,
        ...overrides,
    }
    return { job, createMany, updateMany, loadSource }
}

const STAMP = {
    where: { id: 'vid-1' },
    data: { chaptersScannedAt: expect.any(Date) },
}

beforeEach(() => {
    scanChaptersMock.mockReset().mockResolvedValue({ chapters: [], candidates: 0, coarseFrames: 200 })
    scanSpeechMock.mockReset().mockResolvedValue({
        language: 'en',
        segments: 120,
        chapters: HEARD,
    })
    // The model keeps every title unless a test says otherwise.
    reviewTitlesMock.mockReset().mockImplementation(async (_llm, _context, chapters) => chapters)
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
    it('reads the video’s title and its courses’', async () => {
        const prisma = {
            video: {
                findUnique: jest.fn(async () => ({
                    title: 'Craig Jones Shows the Perfect Kimura',
                    courses: [
                        { lessonTitle: 'Kimura from Side Control', course: { title: 'Kimura' } },
                    ],
                })),
            },
        }
        await expect(loadChapterContext(prisma as never, 'vid-1')).resolves.toEqual({
            videoTitle: 'Craig Jones Shows the Perfect Kimura',
            courses: [{ title: 'Kimura', lessonTitle: 'Kimura from Side Control' }],
        })
        expect(prisma.video.findUnique.mock.calls[0]).toEqual([
            {
                where: { id: 'vid-1' },
                select: {
                    title: true,
                    courses: { select: { lessonTitle: true, course: { select: { title: true } } } },
                },
            },
        ])
    })

    it('has empty titles for a video that is gone', async () => {
        const prisma = { video: { findUnique: jest.fn(async () => null) } }
        await expect(loadChapterContext(prisma as never, 'vid-1')).resolves.toEqual({
            videoTitle: '',
            courses: [],
        })
    })
})

describe('makeChapters', () => {
    it('only stamps a video that has chapters, without downloading it', async () => {
        const { job, loadSource, updateMany } = build([3])
        await expect(makeChapters(job)).resolves.toEqual({ outcome: 'kept', chapters: 0 })
        expect(loadSource).not.toHaveBeenCalled()
        expect(scanChaptersMock).not.toHaveBeenCalled()
        expect(updateMany).toHaveBeenCalledWith(STAMP)
    })

    it('stores the titles the model keeps, does not listen, and stamps the video', async () => {
        scanChaptersMock.mockResolvedValue({ chapters: TITLES, candidates: 2, coarseFrames: 381 })
        const { job, createMany, updateMany } = build()
        await expect(makeChapters(job)).resolves.toEqual({
            outcome: 'created',
            source: 'ocr',
            chapters: 2,
            ocr: { candidates: 2, frames: 381, reviewed: '2 of 2', ms: expect.any(Number) },
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
        expect(scanSpeechMock).not.toHaveBeenCalled()
        expect(updateMany).toHaveBeenCalledWith(STAMP)
    })

    it('stores OCR titles unreviewed without a chat model', async () => {
        scanChaptersMock.mockResolvedValue({ chapters: TITLES, candidates: 2, coarseFrames: 381 })
        const { job } = build([0], { llm: null })
        await expect(makeChapters(job)).resolves.toMatchObject({
            outcome: 'created',
            source: 'ocr',
            ocr: { candidates: 2, frames: 381 },
        })
        expect(reviewTitlesMock).not.toHaveBeenCalled()
    })

    it('listens when the model rejects the titles down to fewer than two', async () => {
        scanChaptersMock.mockResolvedValue({ chapters: TITLES, candidates: 2, coarseFrames: 381 })
        reviewTitlesMock.mockResolvedValue(TITLES.slice(0, 1))
        const { job, createMany } = build()
        await expect(makeChapters(job)).resolves.toMatchObject({
            outcome: 'created',
            source: 'speech',
            ocr: { reviewed: '1 of 2' },
        })
        expect(createMany.mock.calls[0][0].data[0].source).toBe('speech')
    })

    it('falls back to what the instructor says', async () => {
        scanChaptersMock.mockResolvedValue({
            chapters: [],
            candidates: 0,
            coarseFrames: 200,
            textHeavy: true,
        })
        const { job, createMany } = build()
        await expect(makeChapters(job)).resolves.toEqual({
            outcome: 'created',
            source: 'speech',
            chapters: 2,
            ocr: { candidates: 0, frames: 200, textHeavy: true, ms: expect.any(Number) },
            speech: { language: 'en', segments: 120, ms: expect.any(Number) },
        })
        expect(scanSpeechMock).toHaveBeenCalledWith({
            config: SPEECH,
            context: CONTEXT,
            ffmpegBinary: 'ffmpeg',
            inputArgs: ['-f', 'mov'],
            inputPath: '/tmp/work/source',
            durationSec: 600,
            workdir: '/tmp/work',
            timeoutMs: 600_000,
        })
        expect(createMany.mock.calls[0]).toEqual([
            { data: HEARD.map((t) => ({ videoId: 'vid-1', ...t, source: 'speech' })) },
        ])
    })

    it('reports why speech gave no chapters and stamps the video', async () => {
        scanSpeechMock.mockResolvedValue({
            language: null,
            segments: 0,
            chapters: [],
            rejected: 'no speech',
        })
        const { job, createMany, updateMany } = build()
        await expect(makeChapters(job)).resolves.toMatchObject({
            outcome: 'none',
            chapters: 0,
            speech: { language: null, segments: 0, rejected: 'no speech' },
        })
        expect(createMany).not.toHaveBeenCalled()
        expect(updateMany).toHaveBeenCalledWith(STAMP)
    })

    it('does not listen when the step is off or the video is silent', async () => {
        for (const [overrides, source] of [
            [{ speech: null }, {}],
            // The speech step needs the context the chat model gets.
            [{ llm: null }, {}],
            [{}, { hasAudio: false }],
        ] as const) {
            const { job } = build([0], overrides, source)
            await expect(makeChapters(job)).resolves.toEqual({
                outcome: 'none',
                chapters: 0,
                ocr: { candidates: 0, frames: 200, ms: expect.any(Number) },
            })
        }
        expect(scanSpeechMock).not.toHaveBeenCalled()
    })

    it('does not listen once someone added chapters during the OCR pass', async () => {
        const { job } = build([0, 2])
        await expect(makeChapters(job)).resolves.toMatchObject({ outcome: 'kept', chapters: 0 })
        expect(scanSpeechMock).not.toHaveBeenCalled()
    })

    it('leaves the video unscanned when a step fails, so it is tried again', async () => {
        scanSpeechMock.mockRejectedValue(new Error('chapters LLM answered HTTP 402: no credits'))
        const { job, createMany, updateMany } = build()
        await expect(makeChapters(job)).rejects.toThrow('HTTP 402')
        expect(createMany).not.toHaveBeenCalled()
        expect(updateMany).not.toHaveBeenCalled()
    })
})
