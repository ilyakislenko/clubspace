jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../domains/video/services/video.service', () => ({
    VideoService: class {},
}))
jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { GetWorkspaceVideoFeature } from './get-workspace-video.feature'
import { GetWorkspaceVideoHandler } from './get-workspace-video.handler'

const DETAIL = {
    id: 'v1',
    playlists: [{ id: 'open' }, { id: 'hidden' }],
}

const build = (o: {
    video?: unknown
    refuse?: Error
    visibleCourseIds?: string[] | null
}) => {
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    'video' in o ? o.video : { id: 'v1', workspaceId: 'ws-1' },
                ),
        },
    }
    const courseAccess = {
        assertCanWatchVideo: o.refuse
            ? jest.fn().mockRejectedValue(o.refuse)
            : jest.fn().mockResolvedValue({
                  isStaff: o.visibleCourseIds === null,
                  visibleCourseIds:
                      o.visibleCourseIds === undefined ? ['open'] : o.visibleCourseIds,
              }),
    }
    const videoService = { getVideo: jest.fn().mockResolvedValue(DETAIL) }
    const handler = new GetWorkspaceVideoHandler(
        prisma as never,
        courseAccess as never,
        videoService as never,
    )
    return { handler, prisma, courseAccess, videoService }
}

const run = (handler: GetWorkspaceVideoHandler) =>
    handler.execute(new GetWorkspaceVideoFeature('ws-1', 'v1', 'u1'))

describe('GetWorkspaceVideoHandler', () => {
    it('refuses a student the access gate refuses (locked lesson)', async () => {
        const { handler, videoService } = build({
            refuse: new ForbiddenError({ message: 'Сначала посмотрите предыдущий урок' }),
        })
        await expect(run(handler)).rejects.toThrow(
            'Сначала посмотрите предыдущий урок',
        )
        expect(videoService.getVideo).not.toHaveBeenCalled()
    })

    it('404s a video of another club', async () => {
        const { handler, prisma, courseAccess } = build({ video: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.video.findFirst.mock.calls[0][0].where).toEqual({
            id: 'v1',
            workspaceId: 'ws-1',
        })
        expect(courseAccess.assertCanWatchVideo).not.toHaveBeenCalled()
    })

    it('drops courses hidden from the student', async () => {
        const { handler, courseAccess } = build({})
        const out = await run(handler)
        expect(courseAccess.assertCanWatchVideo).toHaveBeenCalledWith(
            { id: 'v1', workspaceId: 'ws-1' },
            'u1',
        )
        expect(out.playlists).toEqual([{ id: 'open' }])
    })

    it('returns the whole detail to staff', async () => {
        const { handler } = build({ visibleCourseIds: null })
        expect(await run(handler)).toBe(DETAIL)
    })
})
