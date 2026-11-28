// No trial cap in force unless a test says so (TrialLimitsService is covered
// in its own spec and in trial-guards.e2e-spec.ts).
const trialLimits = {
    trialStorage: jest.fn().mockResolvedValue(null),
    assertCanPlayVideo: jest.fn().mockResolvedValue(undefined),
}

jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    Prisma: {},
    NotificationTypeEnum: { EMAIL: 'EMAIL', PUSH: 'PUSH', TELEGRAM: 'TELEGRAM' },
    MemberStatus: {
        ACTIVE: 'ACTIVE',
        SUSPENDED: 'SUSPENDED',
        INVITED: 'INVITED',
        BLOCKED: 'BLOCKED',
    },
}))
jest.mock('../../../infrastructure/files/services/files.service', () => ({
    FilesService: class {},
}))
jest.mock('../../../environments/environment', () => ({
    environment: {
        s3Storage: {},
        rootUrl: 'https://api.example',
        playbackTokenSecret: 'video-spec-playback-secret-long-enough',
    },
}))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import {
    tooLargeMessage,
    VideoService,
    webPlaybackTtlSeconds,
} from './video.service'

type PrismaOverrides = {
    video?: unknown
    tags?: Array<{ id: string }>
    categories?: Array<{ id: string }>
    course?: unknown
    courses?: Array<{ id: string }>
}

const build = (o: PrismaOverrides = {}) => {
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue('video' in o ? o.video : { id: 'vid-1' }),
        },
        tagEntity: { findMany: jest.fn().mockResolvedValue(o.tags ?? []) },
        category: { findMany: jest.fn().mockResolvedValue(o.categories ?? []) },
        course: {
            findFirst: jest
                .fn()
                .mockResolvedValue('course' in o ? o.course : { id: 'c1' }),
            findMany: jest.fn().mockResolvedValue(o.courses ?? []),
        },
        // Validation throws before the transaction; for the happy path just
        // resolve so updateVideo returns without executing the real callback.
        $transaction: jest.fn().mockResolvedValue({ id: 'vid-1' }),
    }
    const service = new VideoService(
        prisma as never,
        {} as never,
        { notifyWorkspace: jest.fn() } as never,
        {} as never,
        trialLimits as never,
    )
    return { service, prisma }
}

const update = (service: VideoService, data: Record<string, unknown>) =>
    service.updateVideo({ workspaceId: 'ws-1', videoId: 'vid-1', data })

describe('VideoService.updateVideo cross-tenant validation', () => {
    it('throws when the video is not in this workspace', async () => {
        const { service } = build({ video: null })
        await expect(update(service, { title: 'x' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('rejects tags that do not all belong to the workspace', async () => {
        // Asked to attach two tags, but only one exists in this workspace.
        const { service } = build({ tags: [{ id: 't1' }] })
        await expect(
            update(service, { tagIds: ['t1', 't2'] }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('rejects categories that do not all belong to the workspace', async () => {
        const { service } = build({ categories: [{ id: 'cat1' }] })
        await expect(
            update(service, { categoryIds: ['cat1', 'cat2'] }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('rejects a playlistId from another workspace', async () => {
        const { service } = build({ course: null })
        await expect(
            update(service, { playlistId: 'foreign-course' }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('rejects playlistIds that do not all belong to the workspace', async () => {
        const { service } = build({ courses: [{ id: 'c1' }] })
        await expect(
            update(service, { playlistIds: ['c1', 'c2'] }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('passes validation when every reference belongs to the workspace', async () => {
        const { service, prisma } = build({
            tags: [{ id: 't1' }, { id: 't2' }],
            categories: [{ id: 'cat1' }],
            courses: [{ id: 'c1' }],
        })
        // Reaching the write transaction proves validation accepted every
        // reference. (The post-write response mapping isn't stubbed here, so
        // we don't assert on the return value — only that we got past the
        // cross-tenant checks.)
        await update(service, {
            tagIds: ['t1', 't2'],
            categoryIds: ['cat1'],
            playlistIds: ['c1'],
        }).catch(() => undefined)
        expect(prisma.$transaction).toHaveBeenCalled()
    })
})

const buildComplete = (o: {
    video?: unknown
    objectSize?: number | null
}) => {
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    'video' in o
                        ? o.video
                        : { id: 'vid-1', rawBucket: 'raw', rawKey: 'raw/vid-1.mp4' },
                ),
            update: jest.fn().mockResolvedValue({}),
        },
    }
    const files = {
        getObjectSize: jest
            .fn()
            .mockResolvedValue('objectSize' in o ? o.objectSize : 1_000),
        getMaxVideoUploadBytes: jest.fn().mockReturnValue(10 * 1024 ** 3),
        deleteObject: jest.fn().mockResolvedValue(undefined),
        getDefaultBucketName: jest.fn().mockReturnValue('raw'),
    }
    const service = new VideoService(
        prisma as never,
        files as never,
        { notifyWorkspace: jest.fn() } as never,
        {} as never,
        trialLimits as never,
    )
    return { service, prisma, files }
}

describe('VideoService.completeUpload', () => {
    const call = (service: VideoService) =>
        service.completeUpload({ videoId: 'vid-1', workspaceId: 'ws-1' })

    it('throws when the video is not in this workspace', async () => {
        const { service } = buildComplete({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('throws when the video has no rawKey', async () => {
        const { service } = buildComplete({
            video: { id: 'vid-1', rawBucket: 'raw', rawKey: null },
        })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses to complete when the uploaded object is missing', async () => {
        const { service, prisma } = buildComplete({ objectSize: null })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
        // Must not flip the video to "uploaded" (which would enqueue transcoding
        // of a non-existent object).
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('marks the video uploaded once the object is confirmed present, recording its size', async () => {
        const { service, prisma, files } = buildComplete({ objectSize: 1_000 })
        await call(service)
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: { status: 'uploaded', sizeBytes: BigInt(1_000) },
        })
        expect(files.deleteObject).not.toHaveBeenCalled()
    })

    it('still fails the video when deleting the oversized object errors', async () => {
        const { service, prisma, files } = buildComplete({
            objectSize: 10 * 1024 ** 3 + 1,
        })
        files.deleteObject.mockRejectedValueOnce(new Error('s3 down'))
        await expect(call(service)).rejects.toThrow(/больше 10 ГБ/)
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: expect.objectContaining({ status: 'failed' }),
        })
    })

    it('drops an object over the cap and fails the video instead of transcoding it', async () => {
        const { service, prisma, files } = buildComplete({
            objectSize: 10 * 1024 ** 3 + 1,
        })
        await expect(call(service)).rejects.toThrow(/больше 10 ГБ/)
        // Failed before the delete, so a delete error can't strand it.
        expect(prisma.video.update.mock.invocationCallOrder[0]).toBeLessThan(
            files.deleteObject.mock.invocationCallOrder[0],
        )
        expect(files.deleteObject).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1.mp4',
        })
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: expect.objectContaining({ status: 'failed' }),
        })
        expect(prisma.video.update).not.toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'uploaded' }),
            }),
        )
    })
})

describe('VideoService.createUpload', () => {
    const build = () => {
        const prisma = {
            video: {
                create: jest.fn().mockResolvedValue({ id: 'vid-1', rawKey: 'raw/vid-1/source.mp4' }),
            },
        }
        const files = {
            getMaxVideoUploadBytes: jest.fn().mockReturnValue(1_000),
            // Parts of 300 bytes: a 1 000-byte file goes up in 4.
            getMultipartPartBytes: jest.fn().mockReturnValue(300),
            getDefaultBucketName: jest.fn().mockReturnValue('raw'),
            getPresignedPutUrl: jest
                .fn()
                .mockResolvedValue({ url: 'https://s3/x', method: 'PUT' }),
            createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
            getPresignedUploadPartUrl: jest.fn(
                async ({ partNumber }: { partNumber: number }) =>
                    `https://s3/x?partNumber=${partNumber}`,
            ),
        }
        const service = new VideoService(
            prisma as never,
            files as never,
            { notifyWorkspace: jest.fn() } as never,
            {} as never,
            trialLimits as never,
        )
        return { service, prisma, files }
    }
    const base = { workspaceId: 'ws-1', title: 'T', contentType: 'video/mp4' }

    it('refuses a declared size over the cap before writing or signing anything', async () => {
        const { service, prisma, files } = build()
        await expect(
            service.createUpload({ ...base, sizeBytes: 1_001 }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.video.create).not.toHaveBeenCalled()
        expect(files.getPresignedPutUrl).not.toHaveBeenCalled()
    })

    it('signs the declared size into the upload URL, so storage enforces it', async () => {
        const { service, files } = build()
        const out = await service.createUpload({ ...base, sizeBytes: 300 })
        expect(out.videoId).toBe('vid-1')
        expect(files.getPresignedPutUrl).toHaveBeenCalledWith(
            expect.objectContaining({ contentLength: 300 }),
        )
    })

    it('keeps a single PUT for a file no bigger than one part', async () => {
        const { service, prisma, files } = build()
        const out = await service.createUpload({ ...base, sizeBytes: 300 })
        expect(out.upload).toEqual({ url: 'https://s3/x', method: 'PUT' })
        expect(files.createMultipartUpload).not.toHaveBeenCalled()
        expect(files.getPresignedUploadPartUrl).not.toHaveBeenCalled()
        expect(prisma.video.create.mock.calls[0][0].data.rawUploadId).toBeNull()
    })

    it('still works for an older admin that declares no size', async () => {
        const { service, files } = build()
        const out = await service.createUpload(base)
        expect(out.upload.method).toBe('PUT')
        expect(files.createMultipartUpload).not.toHaveBeenCalled()
        expect(files.getPresignedPutUrl).toHaveBeenCalledWith(
            expect.objectContaining({ contentLength: undefined }),
        )
    })

    it('uploads a file bigger than one part in parts, each length signed into its URL', async () => {
        const { service, prisma, files } = build()
        const out = await service.createUpload({ ...base, sizeBytes: 1_000 })

        const create = prisma.video.create.mock.calls[0][0]
        expect(files.createMultipartUpload).toHaveBeenCalledWith({
            bucket: 'raw',
            key: create.data.rawKey,
            contentType: 'video/mp4',
        })
        // The row remembers the upload, so complete/abort/delete find it.
        expect(create.data.rawUploadId).toBe('upload-1')
        expect(files.getPresignedPutUrl).not.toHaveBeenCalled()
        expect(
            files.getPresignedUploadPartUrl.mock.calls.map(([c]) => [
                c.partNumber,
                c.contentLength,
            ]),
        ).toEqual([
            [1, 300],
            [2, 300],
            [3, 300],
            [4, 100],
        ])
        expect(files.getPresignedUploadPartUrl).toHaveBeenCalledWith(
            expect.objectContaining({
                bucket: 'raw',
                key: 'raw/vid-1/source.mp4',
                uploadId: 'upload-1',
                // Outlives a long upload: parts are used one after another.
                expiresInSeconds: 24 * 60 * 60,
            }),
        )
        expect(out.upload).toEqual({
            method: 'MULTIPART',
            uploadId: 'upload-1',
            partSize: 300,
            parts: [1, 2, 3, 4].map((partNumber) => ({
                partNumber,
                url: `https://s3/x?partNumber=${partNumber}`,
            })),
        })
    })

    it('starts no multipart upload for a size over the cap', async () => {
        const { service, files } = build()
        await expect(
            service.createUpload({ ...base, sizeBytes: 1_001 }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(files.createMultipartUpload).not.toHaveBeenCalled()
    })
})

describe('VideoService multipart completion', () => {
    const parts = [
        { partNumber: 2, etag: '"b"' },
        { partNumber: 1, etag: '"a"' },
        { partNumber: 3, etag: '"c"' },
    ]
    const build = (o: { completeError?: unknown } = {}) => {
        const built = buildComplete({
            video: {
                id: 'vid-1',
                rawBucket: 'raw',
                rawKey: 'raw/vid-1/source.mp4',
                rawUploadId: 'upload-1',
            },
        })
        const files = built.files as typeof built.files & {
            completeMultipartUpload: jest.Mock
        }
        files.completeMultipartUpload = o.completeError
            ? jest.fn().mockRejectedValue(o.completeError)
            : jest.fn().mockResolvedValue(undefined)
        return { ...built, files }
    }
    const call = (service: VideoService, p?: typeof parts) =>
        service.completeUpload({ videoId: 'vid-1', workspaceId: 'ws-1', parts: p })

    it('assembles the parts in ascending order before measuring the object', async () => {
        const { service, prisma, files } = build()
        await call(service, parts)
        expect(files.completeMultipartUpload).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1/source.mp4',
            uploadId: 'upload-1',
            parts: [
                { partNumber: 1, etag: '"a"' },
                { partNumber: 2, etag: '"b"' },
                { partNumber: 3, etag: '"c"' },
            ],
        })
        expect(files.completeMultipartUpload.mock.invocationCallOrder[0]).toBeLessThan(
            files.getObjectSize.mock.invocationCallOrder[0],
        )
        // The spent upload id is cleared with the status.
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: { status: 'uploaded', sizeBytes: BigInt(1_000), rawUploadId: null },
        })
    })

    it.each([
        ['no parts', undefined],
        ['an empty list', []],
        ['a missing part', [parts[0], parts[2]]],
        ['a repeated part', [...parts, { partNumber: 2, etag: '"b2"' }]],
    ])('refuses %s without touching storage or the row', async (_case, given) => {
        const { service, prisma, files } = build()
        await expect(call(service, given)).rejects.toBeInstanceOf(BadRequestError)
        expect(files.completeMultipartUpload).not.toHaveBeenCalled()
        expect(files.getObjectSize).not.toHaveBeenCalled()
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('refuses parts storage would not assemble, leaving the upload to retry or abort', async () => {
        const { service, prisma } = build({
            completeError: Object.assign(new Error('bad part'), { name: 'InvalidPart' }),
        })
        await expect(call(service, parts)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('goes on to the size check when an earlier try already assembled the upload', async () => {
        const { service, prisma, files } = build({
            completeError: Object.assign(new Error('gone'), { name: 'NoSuchUpload' }),
        })
        await call(service, parts)
        expect(files.getObjectSize).toHaveBeenCalled()
        expect(prisma.video.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'uploaded' }),
            }),
        )
    })

    it('clears the upload id when the assembled file is refused as too large', async () => {
        const { service, prisma, files } = build()
        files.getObjectSize.mockResolvedValue(10 * 1024 ** 3 + 1)
        await expect(call(service, parts)).rejects.toThrow(/больше 10 ГБ/)
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: expect.objectContaining({ status: 'failed', rawUploadId: null }),
        })
    })
})

describe('VideoService.abortUpload', () => {
    const build = (o: { video?: unknown; abortError?: unknown } = {}) => {
        const prisma = {
            video: {
                findFirst: jest.fn().mockResolvedValue(
                    'video' in o
                        ? o.video
                        : {
                              id: 'vid-1',
                              status: 'uploading',
                              rawBucket: 'raw',
                              rawKey: 'raw/vid-1/source.mp4',
                              rawUploadId: 'upload-1',
                          },
                ),
                delete: jest.fn().mockResolvedValue({}),
            },
        }
        const files = {
            getDefaultBucketName: jest.fn().mockReturnValue('raw'),
            abortMultipartUpload: o.abortError
                ? jest.fn().mockRejectedValue(o.abortError)
                : jest.fn().mockResolvedValue(undefined),
            deleteObject: jest.fn().mockResolvedValue(undefined),
        }
        const service = new VideoService(
            prisma as never,
            files as never,
            { notifyWorkspace: jest.fn() } as never,
            {} as never,
            trialLimits as never,
        )
        return { service, prisma, files }
    }
    const call = (service: VideoService) =>
        service.abortUpload({ videoId: 'vid-1', workspaceId: 'ws-1' })

    it('404s a video of another workspace', async () => {
        const { service, prisma } = build({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.video.findFirst.mock.calls[0][0].where).toEqual({
            id: 'vid-1',
            workspaceId: 'ws-1',
        })
    })

    it.each(['uploaded', 'processing', 'ready'])(
        'refuses a video already handed to transcoding (%s)',
        async (status) => {
            const { service, prisma, files } = build({
                video: { id: 'vid-1', status, rawBucket: 'raw', rawKey: 'k', rawUploadId: null },
            })
            await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
            expect(files.deleteObject).not.toHaveBeenCalled()
            expect(prisma.video.delete).not.toHaveBeenCalled()
        },
    )

    it('aborts the multipart upload, drops any object and the row', async () => {
        const { service, prisma, files } = build()
        await expect(call(service)).resolves.toEqual({ status: 'aborted' })
        expect(files.abortMultipartUpload).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1/source.mp4',
            uploadId: 'upload-1',
        })
        expect(files.deleteObject).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1/source.mp4',
        })
        expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'vid-1' } })
    })

    it('drops a single-PUT upload (or one refused at completion) without an abort call', async () => {
        const { service, prisma, files } = build({
            video: { id: 'vid-1', status: 'failed', rawBucket: 'raw', rawKey: 'k', rawUploadId: null },
        })
        await call(service)
        expect(files.abortMultipartUpload).not.toHaveBeenCalled()
        expect(prisma.video.delete).toHaveBeenCalled()
    })

    it.each([
        ['storage no longer knows the upload', Object.assign(new Error('gone'), { name: 'NoSuchUpload' })],
        ['storage is down', new Error('s3 down')],
    ])('still drops the row when %s', async (_case, abortError) => {
        const { service, prisma } = build({ abortError })
        await expect(call(service)).resolves.toEqual({ status: 'aborted' })
        expect(prisma.video.delete).toHaveBeenCalled()
    })
})

describe('VideoService.deleteVideo', () => {
    it('aborts a multipart upload still in progress', async () => {
        const prisma = {
            video: {
                findFirst: jest.fn().mockResolvedValue({
                    id: 'vid-1',
                    rawBucket: 'raw',
                    rawKey: 'raw/vid-1/source.mp4',
                    rawUploadId: 'upload-1',
                    hlsBucket: 'raw',
                    hlsMasterKey: null,
                }),
                delete: jest.fn().mockResolvedValue({}),
            },
        }
        const files = {
            getDefaultBucketName: jest.fn().mockReturnValue('raw'),
            abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
            deleteObject: jest.fn().mockResolvedValue(undefined),
            deleteObjectsByPrefix: jest.fn().mockResolvedValue(undefined),
        }
        const service = new VideoService(
            prisma as never,
            files as never,
            { notifyWorkspace: jest.fn() } as never,
            {} as never,
            trialLimits as never,
        )
        await expect(
            service.deleteVideo({ videoId: 'vid-1', workspaceId: 'ws-1' }),
        ).resolves.toEqual({ status: 'deleted' })
        expect(files.abortMultipartUpload).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1/source.mp4',
            uploadId: 'upload-1',
        })
        expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'vid-1' } })
    })
})

describe('tooLargeMessage', () => {
    it('reads in GB at gigabyte scale and MB below it', () => {
        expect(tooLargeMessage(10 * 1024 ** 3)).toContain('больше 10 ГБ')
        expect(tooLargeMessage(1.5 * 1024 ** 3)).toContain('больше 1.5 ГБ')
        expect(tooLargeMessage(300 * 1024 ** 2)).toContain('больше 300 МБ')
    })
})

// The membership/audience/progression gate itself is CourseAccessService
// (course-access.service.spec.ts); here it is a stub so these specs pin that
// every offline/playback route calls it before touching storage.
const buildPlayback = (o: { video?: unknown; refuse?: Error }) => {
    const prisma = {
        video: {
            findUnique: jest.fn().mockResolvedValue(
                'video' in o
                    ? o.video
                    : {
                          id: 'vid-1',
                          workspaceId: 'ws-1',
                          status: 'ready',
                          hlsBucket: 'hls',
                          hlsMasterKey: 'hls/vid-1/master.m3u8',
                          rawBucket: 'raw',
                          rawKey: 'raw/vid-1/source.mp4',
                      },
            ),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('hls'),
        getObjectText: jest
            .fn()
            .mockResolvedValue(
                '#EXTM3U\n#EXTINF:4,\nseg_00000.ts\n#EXTINF:4,\nseg_00001.ts\n#EXT-X-ENDLIST',
            ),
        getPresignedGetUrl: jest
            .fn()
            .mockImplementation(({ key }: { key: string }) =>
                Promise.resolve(`https://signed.example/${key}?sig=x`),
            ),
    }
    const courseAccess = {
        assertCanWatchVideo: o.refuse
            ? jest.fn().mockRejectedValue(o.refuse)
            : jest.fn().mockResolvedValue({ isStaff: false }),
    }
    const service = new VideoService(
        prisma as never,
        files as never,
        { notifyWorkspace: jest.fn() } as never,
        courseAccess as never,
        trialLimits as never,
    )
    return { service, prisma, files, courseAccess }
}

const NOT_READY = {
    id: 'vid-1',
    workspaceId: 'ws-1',
    status: 'processing',
    hlsBucket: 'hls',
    hlsMasterKey: null,
    rawBucket: 'raw',
    rawKey: null,
}

const LOCKED = new ForbiddenError({ message: 'Доступно с уровня «Синий пояс»' })

describe('VideoService.getOfflineManifest', () => {
    const call = (service: VideoService) =>
        service.getOfflineManifest({ videoId: 'vid-1', userId: 'u1' })

    it('returns a flat playlist with segments signed for 30 minutes', async () => {
        const { service, files, courseAccess } = buildPlayback({})
        const { manifest } = await call(service)
        expect(courseAccess.assertCanWatchVideo).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'vid-1', workspaceId: 'ws-1' }),
            'u1',
        )
        // Pulls the 720p rung (v1) and signs each segment under its dir.
        expect(files.getObjectText).toHaveBeenCalledWith({
            bucket: 'hls',
            key: 'hls/vid-1/v1/playlist.m3u8',
        })
        expect(manifest).toContain(
            'https://signed.example/hls/vid-1/v1/seg_00000.ts',
        )
        expect(manifest).not.toMatch(/^seg_00000\.ts$/m)
        // Tag lines are preserved.
        expect(manifest).toContain('#EXTINF:4,')
        expect(files.getPresignedGetUrl).toHaveBeenCalledWith(
            expect.objectContaining({ expiresInSeconds: 30 * 60 }),
        )
    })

    it('falls back to v0 when the 720p rung is missing', async () => {
        const { service, files } = buildPlayback({})
        files.getObjectText
            .mockRejectedValueOnce(new Error('no v1'))
            .mockResolvedValueOnce('#EXTM3U\nseg_00000.ts\n#EXT-X-ENDLIST')
        const { manifest } = await call(service)
        expect(manifest).toContain(
            'https://signed.example/hls/vid-1/v0/seg_00000.ts',
        )
    })

    it('refuses before reading storage when the gate refuses', async () => {
        const { service, files } = buildPlayback({ refuse: LOCKED })
        await expect(call(service)).rejects.toBe(LOCKED)
        expect(files.getObjectText).not.toHaveBeenCalled()
    })

    it('404s an unknown video', async () => {
        const { service } = buildPlayback({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('rejects a video that is not ready', async () => {
        const { service } = buildPlayback({ video: NOT_READY })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })
})

describe('VideoService.getOfflineDownload', () => {
    const call = (service: VideoService) =>
        service.getOfflineDownload({ videoId: 'vid-1', userId: 'u1' })

    it('signs the MP4 for 30 minutes, not hours', async () => {
        const { service, files } = buildPlayback({})
        const out = await call(service)
        expect(out).toEqual({
            url: 'https://signed.example/raw/vid-1/source.mp4?sig=x',
            mimeType: 'video/mp4',
        })
        expect(files.getPresignedGetUrl).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1/source.mp4',
            expiresInSeconds: 30 * 60,
        })
    })

    it('hands out no URL when the gate refuses', async () => {
        const { service, files } = buildPlayback({ refuse: LOCKED })
        await expect(call(service)).rejects.toBe(LOCKED)
        expect(files.getPresignedGetUrl).not.toHaveBeenCalled()
    })

    it('404s an unknown video', async () => {
        const { service } = buildPlayback({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('rejects a video that is not ready', async () => {
        const { service } = buildPlayback({ video: NOT_READY })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })
})

describe('webPlaybackTtlSeconds', () => {
    it('covers the lesson plus 30 minutes', () => {
        expect(webPlaybackTtlSeconds(100)).toBe(100 + 30 * 60)
        // A 45-minute lesson outlives the 30-minute offline link.
        expect(webPlaybackTtlSeconds(45 * 60)).toBe(75 * 60)
        expect(webPlaybackTtlSeconds(90.4)).toBe(91 + 30 * 60)
    })

    it('never exceeds 6 hours and falls back to it without a duration', () => {
        expect(webPlaybackTtlSeconds(10 * 60 * 60)).toBe(6 * 60 * 60)
        expect(webPlaybackTtlSeconds(null)).toBe(6 * 60 * 60)
        expect(webPlaybackTtlSeconds(0)).toBe(6 * 60 * 60)
    })
})

describe('VideoService.getWebPlayback', () => {
    const VIDEO = {
        id: 'vid-1',
        workspaceId: 'ws-1',
        status: 'ready',
        rawBucket: 'raw',
        rawKey: 'raw/vid-1/source.mp4',
        duration: 45 * 60,
    }
    const call = (service: VideoService) =>
        service.getWebPlayback({ videoId: 'vid-1', userId: 'u1' })

    it('signs the MP4 for the lesson length, not the offline 30 minutes', async () => {
        const { service, files, courseAccess } = buildPlayback({ video: VIDEO })
        const out = await call(service)
        expect(courseAccess.assertCanWatchVideo).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'vid-1', workspaceId: 'ws-1' }),
            'u1',
        )
        expect(files.getPresignedGetUrl).toHaveBeenCalledWith({
            bucket: 'raw',
            key: 'raw/vid-1/source.mp4',
            expiresInSeconds: 75 * 60,
        })
        expect(out).toEqual({
            url: 'https://signed.example/raw/vid-1/source.mp4?sig=x',
            mimeType: 'video/mp4',
            expiresInSeconds: 75 * 60,
        })
    })

    it('hands out no URL when the gate refuses', async () => {
        const { service, files } = buildPlayback({ video: VIDEO, refuse: LOCKED })
        await expect(call(service)).rejects.toBe(LOCKED)
        expect(files.getPresignedGetUrl).not.toHaveBeenCalled()
    })

    it('404s an unknown video', async () => {
        const { service } = buildPlayback({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('rejects a video that is not ready', async () => {
        const { service } = buildPlayback({ video: NOT_READY })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })
})

describe('VideoService.getPlaybackUrl', () => {
    const call = (service: VideoService) =>
        service.getPlaybackUrl({ videoId: 'vid-1', userId: 'u1' })

    it('issues a manifest URL once the gate passes', async () => {
        const { service } = buildPlayback({})
        const out = await call(service)
        expect(out.hlsUrl).toMatch(/\/videos\/vid-1\/manifest\.m3u8\?token=/)
    })

    it('refuses when the gate refuses', async () => {
        const { service } = buildPlayback({ refuse: LOCKED })
        await expect(call(service)).rejects.toBe(LOCKED)
    })

    it('404s an unknown video', async () => {
        const { service } = buildPlayback({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('rejects a video that is not ready', async () => {
        const { service } = buildPlayback({ video: NOT_READY })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })
})
