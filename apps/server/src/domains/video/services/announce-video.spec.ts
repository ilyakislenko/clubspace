import { announceVideoIfLive } from './announce-video'

const makePrisma = (video: unknown, liveCourse: unknown) => ({
    video: { findFirst: jest.fn().mockResolvedValue(video) },
    courseVideo: { findFirst: jest.fn().mockResolvedValue(liveCourse) },
})

describe('announceVideoIfLive', () => {
    it('notifies members when a ready video sits in a published course', async () => {
        const prisma = makePrisma(
            { title: 'Berimbolo', status: 'ready' },
            { courseId: 'c1' },
        )
        const notifyWorkspace = jest.fn().mockResolvedValue(3)

        await announceVideoIfLive(prisma as never, { notifyWorkspace } as never, {
            workspaceId: 'w1',
            videoId: 'v1',
            actorId: 'coach1',
        })

        expect(notifyWorkspace).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'w1',
                kind: 'video.published',
                refId: 'v1',
                message: 'Berimbolo',
                metadata: { videoId: 'v1' },
                excludeUserId: 'coach1',
                category: 'newVideosEnabled',
                feature: 'videos',
            }),
        )
    })

    it('does not notify while the video is still transcoding', async () => {
        const prisma = makePrisma(
            { title: 'x', status: 'processing' },
            { courseId: 'c1' },
        )
        const notifyWorkspace = jest.fn()

        await announceVideoIfLive(prisma as never, { notifyWorkspace } as never, {
            workspaceId: 'w1',
            videoId: 'v1',
        })

        expect(notifyWorkspace).not.toHaveBeenCalled()
        // Bails before even checking course membership.
        expect(prisma.courseVideo.findFirst).not.toHaveBeenCalled()
    })

    it('does not notify when the video is in no published course', async () => {
        const prisma = makePrisma({ title: 'x', status: 'ready' }, null)
        const notifyWorkspace = jest.fn()

        await announceVideoIfLive(prisma as never, { notifyWorkspace } as never, {
            workspaceId: 'w1',
            videoId: 'v1',
        })

        expect(notifyWorkspace).not.toHaveBeenCalled()
    })

    it('does not notify for an unknown video', async () => {
        const prisma = makePrisma(null, { courseId: 'c1' })
        const notifyWorkspace = jest.fn()

        await announceVideoIfLive(prisma as never, { notifyWorkspace } as never, {
            workspaceId: 'w1',
            videoId: 'v1',
        })

        expect(notifyWorkspace).not.toHaveBeenCalled()
    })
})
