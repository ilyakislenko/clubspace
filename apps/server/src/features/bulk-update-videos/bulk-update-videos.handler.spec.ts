// VideoService's real module transitively imports the ESM-only `uuid` package,
// which the swc/jest transform doesn't process (node_modules is not
// transformed). This handler only ever calls a mocked videoService, so stub the
// module with a factory to keep that import chain out of the test entirely.
jest.mock('../../domains/video/services/video.service', () => ({
    VideoService: class {},
}))

import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    BulkUpdateVideosFeature,
    type BulkVideoAction,
} from './bulk-update-videos.feature'
import { BulkUpdateVideosHandler } from './bulk-update-videos.handler'

const makeDeps = (opts: { ownedIds?: string[]; category?: unknown } = {}) => {
    const ownedIds = opts.ownedIds ?? ['v1', 'v2']
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: any = {
        video: {
            findMany: jest
                .fn()
                .mockResolvedValue(ownedIds.map((id) => ({ id }))),
            updateMany: jest
                .fn()
                .mockResolvedValue({ count: ownedIds.length }),
        },
        category: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    'category' in opts ? opts.category : { id: 'c1' },
                ),
        },
        videoCategory: {
            createMany: jest
                .fn()
                .mockResolvedValue({ count: ownedIds.length }),
            deleteMany: jest
                .fn()
                .mockResolvedValue({ count: ownedIds.length }),
        },
    }
    const videoService = { deleteVideo: jest.fn().mockResolvedValue({}) }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return { prisma, videoService, audit }
}

const run = (
    deps: ReturnType<typeof makeDeps>,
    action: BulkVideoAction,
    extra: { videoIds?: string[]; categoryId?: string } = {},
) =>
    new BulkUpdateVideosHandler(
        deps.prisma as never,
        deps.videoService as never,
        deps.audit as never,
    ).execute(
        new BulkUpdateVideosFeature(
            {
                workspaceId: 'w1',
                videoIds: extra.videoIds ?? ['v1', 'v2'],
                action,
                categoryId: extra.categoryId,
            },
            'u1',
        ),
    )

describe('bulkUpdateVideos', () => {
    it('sets access with a single updateMany', async () => {
        const deps = makeDeps()
        const res = await run(deps, 'setPublic')
        expect(deps.prisma.video.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['v1', 'v2'] }, workspaceId: 'w1' },
            data: { isPublic: true },
        })
        expect(res.affected).toBe(2)
    })

    it('setPrivate writes isPublic:false', async () => {
        const deps = makeDeps()
        await run(deps, 'setPrivate')
        expect(deps.prisma.video.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: { isPublic: false } }),
        )
    })

    it('adds a category via createMany skipDuplicates', async () => {
        const deps = makeDeps()
        const res = await run(deps, 'addCategory', { categoryId: 'c1' })
        expect(deps.prisma.videoCategory.createMany).toHaveBeenCalledWith({
            data: [
                { videoId: 'v1', categoryId: 'c1' },
                { videoId: 'v2', categoryId: 'c1' },
            ],
            skipDuplicates: true,
        })
        expect(res.affected).toBe(2)
    })

    it('removes a category via deleteMany', async () => {
        const deps = makeDeps()
        await run(deps, 'removeCategory', { categoryId: 'c1' })
        expect(deps.prisma.videoCategory.deleteMany).toHaveBeenCalledWith({
            where: { categoryId: 'c1', videoId: { in: ['v1', 'v2'] } },
        })
    })

    it('requires categoryId for category actions', async () => {
        const deps = makeDeps()
        await expect(run(deps, 'addCategory')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('rejects a category from another workspace', async () => {
        const deps = makeDeps({ category: null })
        await expect(
            run(deps, 'addCategory', { categoryId: 'c1' }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('deletes each owned video through the video service', async () => {
        const deps = makeDeps()
        const res = await run(deps, 'delete')
        expect(deps.videoService.deleteVideo).toHaveBeenCalledTimes(2)
        expect(deps.videoService.deleteVideo).toHaveBeenCalledWith({
            videoId: 'v1',
            workspaceId: 'w1',
        })
        expect(res.affected).toBe(2)
    })

    it('is a no-op when none of the ids belong to the workspace', async () => {
        const deps = makeDeps({ ownedIds: [] })
        const res = await run(deps, 'setPublic', { videoIds: ['foreign'] })
        expect(res.affected).toBe(0)
        expect(deps.prisma.video.updateMany).not.toHaveBeenCalled()
        expect(deps.audit.record).not.toHaveBeenCalled()
    })

    it('audits the bulk action once', async () => {
        const deps = makeDeps()
        await run(deps, 'setPublic')
        expect(deps.audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'video.bulkUpdate',
                metadata: expect.objectContaining({
                    action: 'setPublic',
                    count: 2,
                }),
            }),
        )
    })
})
