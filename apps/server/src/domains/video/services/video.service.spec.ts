jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    Prisma: {},
}))
jest.mock('../../../infrastructure/files/services/files.service', () => ({
    FilesService: class {},
}))
jest.mock('../../../environments/environment', () => ({
    environment: { s3Storage: {} },
}))

import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { VideoService } from './video.service'

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
    const service = new VideoService(prisma as never, {} as never)
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
    objectExists?: boolean
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
        objectExists: jest.fn().mockResolvedValue(o.objectExists ?? true),
        getDefaultBucketName: jest.fn().mockReturnValue('raw'),
    }
    const service = new VideoService(prisma as never, files as never)
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
        const { service, prisma } = buildComplete({ objectExists: false })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
        // Must not flip the video to "uploaded" (which would enqueue transcoding
        // of a non-existent object).
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('marks the video uploaded once the object is confirmed present', async () => {
        const { service, prisma } = buildComplete({ objectExists: true })
        await call(service)
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: { status: 'uploaded' },
        })
    })
})
