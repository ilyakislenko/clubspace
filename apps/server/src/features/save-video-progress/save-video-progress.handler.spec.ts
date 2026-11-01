import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { SaveVideoProgressFeature } from './save-video-progress.feature'
import { SaveVideoProgressHandler } from './save-video-progress.handler'

type BuildOpts = {
    video?: { id: string; workspaceId: string; duration: number | null } | null
    // What CourseAccessService.assertCanWatchVideo throws; its membership,
    // audience and progression rules live in course-access.service.spec.ts.
    refuse?: Error
    isStaff?: boolean
    // A lockedProgression course contains the video.
    sequential?: boolean
}

const build = (opts: BuildOpts = {}) => {
    const prisma = {
        video: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.video === undefined
                        ? { id: 'v1', workspaceId: 'w1', duration: 100 }
                        : opts.video,
                ),
            update: jest.fn().mockResolvedValue({}),
        },
        courseVideo: {
            findFirst: jest
                .fn()
                .mockResolvedValue(opts.sequential ? { courseId: 'c1' } : null),
        },
        videoWatched: {
            upsert: jest.fn().mockResolvedValue({
                position: 10,
                completed: false,
                watchedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
        },
    }
    const courseAccess = {
        assertCanWatchVideo: opts.refuse
            ? jest.fn().mockRejectedValue(opts.refuse)
            : jest.fn().mockResolvedValue({
                  isStaff: opts.isStaff ?? false,
                  visibleCourseIds: opts.isStaff ? null : ['c1'],
              }),
    }
    const handler = new SaveVideoProgressHandler(
        prisma as never,
        courseAccess as never,
    )
    return { handler, prisma, courseAccess }
}

const run = (
    handler: SaveVideoProgressHandler,
    payload: Record<string, unknown> = {},
) => handler.execute(new SaveVideoProgressFeature('u1', 'v1', payload) as never)

describe('SaveVideoProgressHandler', () => {
    it('refuses a viewer the access gate refuses, writing nothing', async () => {
        const { handler, prisma, courseAccess } = build({
            refuse: new ForbiddenError({ message: 'Вы не участник этого клуба' }),
        })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(courseAccess.assertCanWatchVideo).toHaveBeenCalledWith(
            { id: 'v1', workspaceId: 'w1', duration: 100 },
            'u1',
        )
        expect(prisma.videoWatched.upsert).not.toHaveBeenCalled()
        // and must not back-fill another workspace's video metadata
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('refuses progress on a lesson still locked by progression', async () => {
        const { handler, prisma } = build({
            refuse: new ForbiddenError({
                message: 'Сначала посмотрите предыдущий урок',
            }),
        })
        await expect(run(handler, { position: 95 })).rejects.toThrow(
            'Сначала посмотрите предыдущий урок',
        )
        expect(prisma.videoWatched.upsert).not.toHaveBeenCalled()
    })

    it('404s when the video does not exist', async () => {
        const { handler } = build({ video: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('saves progress for an active member', async () => {
        const { handler, prisma } = build()
        const result = await run(handler, { position: 10 })
        expect(prisma.videoWatched.upsert).toHaveBeenCalled()
        expect(result.videoId).toBe('v1')
    })

    it("doesn't downgrade completed on an auto, low-position save (seek-back)", async () => {
        const { handler, prisma } = build()
        // position 0 of a 100s video -> autoCompleted false, no explicit flag
        await run(handler, { position: 0 })
        const update = prisma.videoWatched.upsert.mock.calls[0][0].update
        // must NOT write completed:false (would un-complete a finished video)
        expect(update).not.toHaveProperty('completed')
    })

    it('marks completed when an auto reading crosses the threshold', async () => {
        const { handler, prisma } = build()
        await run(handler, { position: 95 }) // 95/100 >= 0.9
        const update = prisma.videoWatched.upsert.mock.calls[0][0].update
        expect(update.completed).toBe(true)
    })

    it('honors an explicit completed:false (intentional un-mark)', async () => {
        const { handler, prisma } = build()
        await run(handler, { position: 95, completed: false })
        const update = prisma.videoWatched.upsert.mock.calls[0][0].update
        expect(update.completed).toBe(false)
    })

    it('honors an explicit mark-watched outside locked progression', async () => {
        const { handler, prisma } = build({ sequential: false })
        await run(handler, { position: 5, completed: true })
        const call = prisma.videoWatched.upsert.mock.calls[0][0]
        expect(call.update.completed).toBe(true)
        expect(call.create.completed).toBe(true)
    })

    it('ignores a student mark-watched below 90% in a locked-progression course', async () => {
        const { handler, prisma } = build({ sequential: true })
        await run(handler, { position: 5, completed: true })
        const call = prisma.videoWatched.upsert.mock.calls[0][0]
        expect(call.update).not.toHaveProperty('completed')
        expect(call.create.completed).toBe(false)
    })

    it('still completes a locked-progression lesson really watched to 90%', async () => {
        const { handler, prisma } = build({ sequential: true })
        await run(handler, { position: 95, completed: true })
        const update = prisma.videoWatched.upsert.mock.calls[0][0].update
        expect(update.completed).toBe(true)
        // Watched for real: no need to look the course up.
        expect(prisma.courseVideo.findFirst).not.toHaveBeenCalled()
    })

    it('lets staff mark a locked-progression lesson watched', async () => {
        const { handler, prisma } = build({ sequential: true, isStaff: true })
        await run(handler, { position: 5, completed: true })
        const update = prisma.videoWatched.upsert.mock.calls[0][0].update
        expect(update.completed).toBe(true)
        expect(prisma.courseVideo.findFirst).not.toHaveBeenCalled()
    })
})
