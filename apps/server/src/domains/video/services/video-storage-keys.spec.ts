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

import {
    BadRequestError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { VideoService } from './video.service'

// H1/L5: every storage key or URL a client hands back is checked against the
// keys this service issues, and a stored key is re-checked before deleting it.

const VIDEO = '11111111-1111-4111-8111-111111111111'
const VICTIM = '22222222-2222-4222-8222-222222222222'
const FILE = '33333333-3333-4333-8333-333333333333'
const OWN_KEY = `subtitles/${VIDEO}/ru/${FILE}.vtt`
const BASE = 'https://s3.example.ru/clubspace/'

const build = (o: { video?: unknown; existing?: unknown; subtitle?: unknown } = {}) => {
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue('video' in o ? o.video : { id: VIDEO }),
        },
        videoSubtitle: {
            findUnique: jest
                .fn()
                .mockResolvedValue('existing' in o ? o.existing : null),
            findFirst: jest
                .fn()
                .mockResolvedValue('subtitle' in o ? o.subtitle : null),
            delete: jest.fn().mockResolvedValue({}),
            create: jest.fn(async ({ data }) => ({ id: 'sub-new', ...data })),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: jest.fn().mockResolvedValue(undefined),
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('clubspace'),
        getPublicObjectUrl: jest.fn(
            ({ key }: { bucket: string; key: string }) => `${BASE}${key}`,
        ),
        getPresignedPutUrl: jest
            .fn()
            .mockResolvedValue({ url: 'https://s3/put', method: 'PUT' }),
        deleteObject: jest.fn().mockResolvedValue(undefined),
    }
    const service = new VideoService(
        prisma as never,
        files as never,
        { notifyWorkspace: jest.fn() } as never,
    )
    return { service, prisma, files }
}

const createSubtitle = (
    service: VideoService,
    over: { storageKey?: string; language?: string } = {},
) =>
    service.createSubtitle({
        workspaceId: 'ws-1',
        videoId: VIDEO,
        language: over.language ?? 'ru',
        label: 'Русские',
        storageKey: over.storageKey ?? OWN_KEY,
    })

describe('VideoService.createSubtitleUpload', () => {
    it('issues a key under this video and language', async () => {
        const { service } = build()
        const out = await service.createSubtitleUpload({
            workspaceId: 'ws-1',
            videoId: VIDEO,
            language: 'ru',
            contentType: 'text/vtt',
        })
        expect(out.key).toMatch(new RegExp(`^subtitles/${VIDEO}/ru/`))
        expect(out.publicUrl).toBe(`${BASE}${out.key}`)
    })

    it('refuses a video from another club', async () => {
        const { service } = build({ video: null })
        await expect(
            service.createSubtitleUpload({
                workspaceId: 'ws-1',
                videoId: VIDEO,
                language: 'ru',
                contentType: 'text/vtt',
            }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('VideoService.createSubtitle', () => {
    it('refuses a video from another club', async () => {
        const { service, prisma } = build({ video: null })
        await expect(createSubtitle(service)).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.videoSubtitle.create).not.toHaveBeenCalled()
    })

    it.each([
        `raw/${VICTIM}/source.mp4`,
        `hls/${VICTIM}/master.m3u8`,
        `subtitles/${VICTIM}/ru/${FILE}.vtt`,
        `subtitles/${VIDEO}/en/${FILE}.vtt`,
    ])('refuses a key it did not issue for this track: %s', async (key) => {
        const { service, prisma, files } = build()
        await expect(
            createSubtitle(service, { storageKey: key }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.videoSubtitle.create).not.toHaveBeenCalled()
        expect(files.deleteObject).not.toHaveBeenCalled()
    })

    it('stores the key with a public URL derived server-side', async () => {
        const { service, prisma } = build()
        const out = await createSubtitle(service)
        expect(prisma.videoSubtitle.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                storageKey: OWN_KEY,
                publicUrl: `${BASE}${OWN_KEY}`,
            }),
        })
        expect(out.publicUrl).toBe(`${BASE}${OWN_KEY}`)
    })

    it('deletes the replaced track file when it is this video’s own key', async () => {
        const previous = `subtitles/${VIDEO}/ru/44444444-4444-4444-8444-444444444444.vtt`
        const { service, files, prisma } = build({
            existing: { id: 'sub-old', storageKey: previous },
        })
        await createSubtitle(service)
        expect(files.deleteObject).toHaveBeenCalledWith({
            bucket: 'clubspace',
            key: previous,
        })
        expect(prisma.videoSubtitle.delete).toHaveBeenCalledWith({
            where: { id: 'sub-old' },
        })
    })

    it('replaces a legacy row with a foreign key without deleting that object', async () => {
        const { service, files, prisma } = build({
            existing: { id: 'sub-old', storageKey: `raw/${VICTIM}/source.mp4` },
        })
        await createSubtitle(service)
        expect(files.deleteObject).not.toHaveBeenCalled()
        expect(prisma.videoSubtitle.delete).toHaveBeenCalled()
    })

    it('does not delete the file just uploaded when the same key is posted again', async () => {
        const { service, files } = build({
            existing: { id: 'sub-old', storageKey: OWN_KEY },
        })
        await createSubtitle(service)
        expect(files.deleteObject).not.toHaveBeenCalled()
    })
})

describe('VideoService.deleteSubtitle', () => {
    const remove = (service: VideoService) =>
        service.deleteSubtitle({
            workspaceId: 'ws-1',
            videoId: VIDEO,
            subtitleId: 'sub-1',
        })

    it('refuses a track outside this club', async () => {
        const { service, files } = build({ subtitle: null })
        await expect(remove(service)).rejects.toBeInstanceOf(NotFoundError)
        expect(files.deleteObject).not.toHaveBeenCalled()
    })

    it('deletes the row and its own file', async () => {
        const { service, files, prisma } = build({
            subtitle: { id: 'sub-1', storageKey: OWN_KEY },
        })
        await expect(remove(service)).resolves.toEqual({ status: 'deleted' })
        expect(prisma.videoSubtitle.delete).toHaveBeenCalledWith({
            where: { id: 'sub-1' },
        })
        expect(files.deleteObject).toHaveBeenCalledWith({
            bucket: 'clubspace',
            key: OWN_KEY,
        })
    })

    it('deletes a legacy row but never the foreign object it names', async () => {
        const { service, files, prisma } = build({
            subtitle: { id: 'sub-1', storageKey: `raw/${VICTIM}/source.mp4` },
        })
        await remove(service)
        expect(prisma.videoSubtitle.delete).toHaveBeenCalled()
        expect(files.deleteObject).not.toHaveBeenCalled()
    })
})

describe('VideoService.createThumbnailUpload', () => {
    it('issues a cover key under this video', async () => {
        const { service } = build()
        const out = await service.createThumbnailUpload({
            workspaceId: 'ws-1',
            videoId: VIDEO,
            contentType: 'image/jpeg',
        })
        expect(out.key).toMatch(new RegExp(`^thumbnails/${VIDEO}/[0-9a-f-]{36}$`))
        expect(out.publicUrl).toBe(`${BASE}${out.key}`)
    })
})

describe('VideoService.updateVideo thumbnailUrl', () => {
    const update = (service: VideoService, thumbnailUrl: string | null) =>
        service.updateVideo({
            workspaceId: 'ws-1',
            videoId: VIDEO,
            data: { thumbnailUrl },
        })

    it.each([
        'https://evil.example/pixel.gif',
        `${BASE}raw/${VIDEO}/source.mp4`,
        `${BASE}thumbnails/${VICTIM}/${FILE}`,
    ])('refuses %s', async (url) => {
        const { service, prisma } = build()
        await expect(update(service, url)).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('accepts a cover uploaded for this video', async () => {
        const { service, prisma } = build()
        await update(service, `${BASE}thumbnails/${VIDEO}/${FILE}`).catch(
            () => undefined,
        )
        expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('accepts clearing the cover', async () => {
        const { service, prisma } = build()
        await update(service, null).catch(() => undefined)
        expect(prisma.$transaction).toHaveBeenCalled()
    })
})
