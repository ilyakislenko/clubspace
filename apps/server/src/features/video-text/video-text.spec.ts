import { Logger } from '@nestjs/common'

import { regenerateJobId, VideoTextProducer } from '../../domains/video/services/video-text.producer'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    GetSubtitleCuesFeature,
    GetVideoTextStatusFeature,
    RegenerateVideoTextFeature,
    RegenerateVideoTextFeatureInputSchema,
} from './video-text.feature'
import { GetSubtitleCuesHandler } from './get-subtitle-cues.handler'
import { GetVideoTextStatusHandler } from './get-video-text-status.handler'
import { RegenerateVideoTextHandler } from './regenerate-video-text.handler'
import { parseVttCues } from './vtt-cues'

const V = '11111111-1111-4111-8111-111111111111'
const key = (lang: string) => `subtitles/${V}/${lang}/22222222-2222-4222-8222-222222222222.vtt`

const build = (
    o: {
        video?: unknown
        state?: 'waiting' | 'active' | null
        autoSubtitles?: Array<{ id: string; storageKey: string }>
    } = {},
) => {
    const prisma = {
        video: {
            findFirst: jest.fn().mockResolvedValue(
                o.video === undefined
                    ? { status: 'ready', timestamps: [{ source: 'ocr' }, { source: 'speech' }] }
                    : o.video,
            ),
            update: jest.fn((a: unknown) => ({ update: a })),
            // reindexChapterMentions: video gone → no-op.
            findUnique: jest.fn().mockResolvedValue(null),
        },
        videoTimestamp: { deleteMany: jest.fn((a: unknown) => ({ deleteTimestamps: a })) },
        videoSubtitle: {
            findMany: jest.fn().mockResolvedValue(o.autoSubtitles ?? []),
            deleteMany: jest.fn(async () => ({ count: (o.autoSubtitles ?? []).length })),
            findFirst: jest.fn(),
        },
        $transaction: jest.fn(async () => [{ count: 2 }, {}]),
    }
    const producer = {
        regenerationState: jest.fn().mockResolvedValue(o.state ?? null),
        enqueueRegeneration: jest.fn().mockResolvedValue(undefined),
    }
    const files = {
        getDefaultBucketName: jest.fn(() => 'bucket'),
        deleteObject: jest.fn().mockResolvedValue(undefined),
        getObjectText: jest.fn(),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const regenerate = new RegenerateVideoTextHandler(
        prisma as never,
        producer as never,
        files as never,
        audit as never,
    )
    return { prisma, producer, files, audit, regenerate }
}

const feature = (chapters: boolean, subtitles: boolean) =>
    new RegenerateVideoTextFeature('w1', V, { chapters, subtitles }, 'u1')

describe('RegenerateVideoTextHandler', () => {
    it('clears the automatic chapters and the scan stamp, then queues the worker', async () => {
        const d = build()
        await expect(d.regenerate.execute(feature(true, false))).resolves.toEqual({
            status: 'queued',
            chaptersRemoved: 2,
            subtitlesRemoved: 0,
        })
        expect(d.prisma.videoTimestamp.deleteMany).toHaveBeenCalledWith({
            where: { videoId: V, source: { in: ['ocr', 'speech'] } },
        })
        expect(d.prisma.video.update).toHaveBeenCalledWith({
            where: { id: V },
            data: { chaptersScannedAt: null },
        })
        expect(d.prisma.videoSubtitle.findMany).not.toHaveBeenCalled()
        expect(d.producer.enqueueRegeneration).toHaveBeenCalledWith(V)
        expect(d.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'video.regenerateText', targetId: V, actorId: 'u1' }),
        )
    })

    it('removes only automatic subtitle tracks and their files', async () => {
        const d = build({
            autoSubtitles: [
                { id: 's1', storageKey: key('en') },
                { id: 's2', storageKey: 'elsewhere/file.vtt' },
            ],
        })
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        d.files.deleteObject.mockRejectedValueOnce(new Error('s3 down'))
        await expect(d.regenerate.execute(feature(false, true))).resolves.toMatchObject({
            chaptersRemoved: 0,
            subtitlesRemoved: 2,
        })
        expect(d.prisma.videoSubtitle.findMany).toHaveBeenCalledWith({
            where: { videoId: V, source: 'auto' },
            select: { id: true, storageKey: true },
        })
        expect(d.prisma.videoSubtitle.deleteMany).toHaveBeenCalledWith({
            where: { id: { in: ['s1', 's2'] }, source: 'auto' },
        })
        // Only a key under the video's subtitles/ prefix is deleted.
        expect(d.files.deleteObject).toHaveBeenCalledTimes(1)
        expect(d.files.deleteObject).toHaveBeenCalledWith({ bucket: 'bucket', key: key('en') })
        // Chapters untouched: the stamp stays, so the worker won't redo them.
        expect(d.prisma.$transaction).not.toHaveBeenCalled()
        expect(d.producer.enqueueRegeneration).toHaveBeenCalledWith(V)
    })

    it('never removes manual chapters: refuses while the video has some', async () => {
        const d = build({ video: { status: 'ready', timestamps: [{ source: 'manual' }] } })
        await expect(d.regenerate.execute(feature(true, true))).rejects.toBeInstanceOf(
            ConflictError,
        )
        expect(d.prisma.videoTimestamp.deleteMany).not.toHaveBeenCalled()
        expect(d.producer.enqueueRegeneration).not.toHaveBeenCalled()
        // Subtitles alone are fine.
        await expect(d.regenerate.execute(feature(false, true))).resolves.toMatchObject({
            status: 'queued',
        })
    })

    it('refuses a video of another club, one still processing, or one already queued', async () => {
        await expect(build({ video: null }).regenerate.execute(feature(true, true))).rejects.toBeInstanceOf(
            NotFoundError,
        )
        await expect(
            build({ video: { status: 'processing', timestamps: [] } }).regenerate.execute(
                feature(true, true),
            ),
        ).rejects.toBeInstanceOf(BadRequestError)
        const busy = build({ state: 'active' })
        await expect(busy.regenerate.execute(feature(true, true))).rejects.toBeInstanceOf(
            ConflictError,
        )
        expect(busy.prisma.$transaction).not.toHaveBeenCalled()
    })

    it('asks for chapters, subtitles or both', () => {
        expect(RegenerateVideoTextFeatureInputSchema.safeParse({ chapters: false, subtitles: false }).success).toBe(false)
        expect(RegenerateVideoTextFeatureInputSchema.safeParse({ chapters: true, subtitles: false }).success).toBe(true)
    })
})

describe('GetVideoTextStatusHandler', () => {
    it('reports the transcript, chapter and subtitle sources and a pending regeneration', async () => {
        const prisma = {
            video: {
                findFirst: jest.fn().mockResolvedValue({
                    status: 'ready',
                    chaptersScannedAt: new Date('2026-05-01T10:00:00Z'),
                    transcript: {
                        language: 'en',
                        segments: [{}, {}, {}],
                        translations: { ru: [{}] },
                        updatedAt: new Date('2026-05-01T09:00:00Z'),
                    },
                    timestamps: [{ source: 'manual' }, { source: 'ocr' }, { source: 'speech' }],
                    subtitles: [{ source: 'auto' }, { source: 'manual' }],
                }),
            },
        }
        const producer = { regenerationState: jest.fn().mockResolvedValue('waiting') }
        const handler = new GetVideoTextStatusHandler(prisma as never, producer as never)
        await expect(handler.execute(new GetVideoTextStatusFeature('w1', V))).resolves.toEqual({
            videoStatus: 'ready',
            chaptersScannedAt: '2026-05-01T10:00:00.000Z',
            transcript: {
                language: 'en',
                segmentCount: 3,
                translatedRu: true,
                updatedAt: '2026-05-01T09:00:00.000Z',
            },
            chapters: { manual: 1, auto: 2 },
            subtitles: { manual: 1, auto: 1 },
            regeneration: 'waiting',
        })
        expect(prisma.video.findFirst.mock.calls[0][0].where).toEqual({ id: V, workspaceId: 'w1' })
    })

    it('copes with no transcript and 404s another club’s video', async () => {
        const prisma = {
            video: {
                findFirst: jest
                    .fn()
                    .mockResolvedValueOnce({
                        status: 'ready',
                        chaptersScannedAt: null,
                        transcript: null,
                        timestamps: [],
                        subtitles: [],
                    })
                    .mockResolvedValueOnce(null),
            },
        }
        const handler = new GetVideoTextStatusHandler(prisma as never, {
            regenerationState: jest.fn().mockResolvedValue(null),
        } as never)
        await expect(handler.execute(new GetVideoTextStatusFeature('w1', V))).resolves.toMatchObject({
            transcript: null,
            chaptersScannedAt: null,
        })
        await expect(handler.execute(new GetVideoTextStatusFeature('w1', V))).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})

describe('GetSubtitleCuesHandler', () => {
    it('reads the track from storage and returns its cues', async () => {
        const prisma = {
            videoSubtitle: { findFirst: jest.fn().mockResolvedValue({ storageKey: key('ru') }) },
        }
        const files = {
            getDefaultBucketName: () => 'bucket',
            getObjectText: jest
                .fn()
                .mockResolvedValue('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nПривет\n'),
        }
        const handler = new GetSubtitleCuesHandler(prisma as never, files as never)
        await expect(handler.execute(new GetSubtitleCuesFeature('w1', V, 's1'))).resolves.toEqual({
            cues: [{ from: 1, to: 2.5, text: 'Привет' }],
            total: 1,
        })
        expect(prisma.videoSubtitle.findFirst.mock.calls[0][0].where).toEqual({
            id: 's1',
            videoId: V,
            video: { workspaceId: 'w1' },
        })
        expect(files.getObjectText).toHaveBeenCalledWith({ bucket: 'bucket', key: key('ru') })
    })

    it('404s a missing track or one stored outside the video', async () => {
        const prisma = {
            videoSubtitle: {
                findFirst: jest
                    .fn()
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce({ storageKey: 'other/x.vtt' }),
            },
        }
        const handler = new GetSubtitleCuesHandler(prisma as never, {} as never)
        for (let i = 0; i < 2; i++) {
            await expect(
                handler.execute(new GetSubtitleCuesFeature('w1', V, 's1')),
            ).rejects.toBeInstanceOf(NotFoundError)
        }
    })
})

describe('parseVttCues', () => {
    it('reads cues with or without hours, ids, settings and tags', () => {
        const vtt = [
            'WEBVTT',
            '',
            'NOTE made by the worker',
            '',
            '1',
            '00:01.5 --> 00:03.000 align:start',
            '<i>Kimura</i> grip',
            'second line',
            '',
            '01:00:00,000 --> 01:00:02.000',
            'hour mark',
            '',
            'bad --> 00:01.000',
            'skipped',
            '',
            '00:05.000 --> 00:06.000',
            '',
        ].join('\r\n')
        expect(parseVttCues(vtt)).toEqual([
            { from: 1.5, to: 3, text: 'Kimura grip\nsecond line' },
            { from: 3600, to: 3602, text: 'hour mark' },
        ])
    })
})

describe('VideoTextProducer', () => {
    const job = (state: string) => ({
        getState: jest.fn().mockResolvedValue(state),
        isFailed: jest.fn().mockResolvedValue(state === 'failed'),
        isCompleted: jest.fn().mockResolvedValue(state === 'completed'),
        remove: jest.fn().mockResolvedValue(undefined),
    })

    it.each([
        ['waiting', 'waiting'],
        ['delayed', 'waiting'],
        ['active', 'active'],
        ['completed', null],
    ])('reports a %s job as %s', async (state, expected) => {
        const queue = { getJob: jest.fn().mockResolvedValue(job(state)) }
        await expect(new VideoTextProducer(queue as never).regenerationState(V)).resolves.toBe(
            expected,
        )
        expect(queue.getJob).toHaveBeenCalledWith(regenerateJobId(V))
    })

    it('queues a regenerate job, clearing a finished one that holds the id', async () => {
        const old = job('failed')
        const queue = {
            getJob: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(old),
            add: jest.fn().mockResolvedValue({}),
        }
        const producer = new VideoTextProducer(queue as never)
        await expect(producer.regenerationState(V)).resolves.toBeNull()
        await producer.enqueueRegeneration(V)
        expect(old.remove).toHaveBeenCalled()
        expect(queue.add).toHaveBeenCalledWith(
            'video-chapters',
            { videoId: V, regenerate: true },
            { jobId: `chapters-regen-${V}`, removeOnComplete: true, removeOnFail: true },
        )
    })
})
