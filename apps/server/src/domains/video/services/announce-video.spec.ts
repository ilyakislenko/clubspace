import { announceVideoIfLive } from './announce-video'

// `liveCourse` truthy = the video sits in one published course open to the
// whole club; `liveCourses` overrides that with explicit GROUP audiences.
const makePrisma = (
    video: unknown,
    liveCourse: unknown,
    liveCourses?: Array<{ course: { audience: Array<{ groupId: string | null }> } }>,
) => ({
    video: { findFirst: jest.fn().mockResolvedValue(video) },
    courseVideo: {
        findMany: jest
            .fn()
            .mockResolvedValue(
                liveCourses ?? (liveCourse ? [{ course: { audience: [] } }] : []),
            ),
    },
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
        // Open to the whole club: no recipient filter.
        expect(notifyWorkspace.mock.calls[0][0]).not.toHaveProperty('memberWhere')
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
        expect(prisma.courseVideo.findMany).not.toHaveBeenCalled()
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

    it('notifies only staff and the groups when every live course is group-only', async () => {
        const prisma = makePrisma({ title: 'Kids drill', status: 'ready' }, null, [
            { course: { audience: [{ groupId: 'g1' }, { groupId: null }] } },
            { course: { audience: [{ groupId: 'g2' }] } },
        ])
        const notifyWorkspace = jest.fn().mockResolvedValue(1)

        await announceVideoIfLive(prisma as never, { notifyWorkspace } as never, {
            workspaceId: 'w1',
            videoId: 'v1',
        })

        expect(notifyWorkspace.mock.calls[0][0].memberWhere).toEqual({
            OR: [
                { role: { name: { in: ['admin', 'head_coach', 'coach'] } } },
                {
                    user: {
                        groupMemberships: {
                            some: { groupId: { in: ['g1', 'g2'] } },
                        },
                    },
                },
            ],
        })
    })

    it('notifies everyone when one live course is open to the club', async () => {
        const prisma = makePrisma({ title: 'Drill', status: 'ready' }, null, [
            { course: { audience: [{ groupId: 'g1' }] } },
            { course: { audience: [] } },
        ])
        const notifyWorkspace = jest.fn().mockResolvedValue(1)

        await announceVideoIfLive(prisma as never, { notifyWorkspace } as never, {
            workspaceId: 'w1',
            videoId: 'v1',
        })

        expect(notifyWorkspace.mock.calls[0][0]).not.toHaveProperty('memberWhere')
    })
})
