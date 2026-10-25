import { UpdatePlaylistFeature } from './update-playlist.feature'
import { UpdatePlaylistHandler } from './update-playlist.handler'

// PlaylistService drags in FilesService -> uuid (ESM), which jest doesn't
// transform. We inject a mock service instance anyway, so replace the module
// with a stub via a factory so the real chain never loads at import time.
jest.mock('../../domains/playlist/services/playlist.service', () => ({
    PlaylistService: class {},
}))

const makeDeps = (oldPublishedAt: Date | null, newPublishedAt: string | null) => {
    const notifyWorkspace = jest.fn().mockResolvedValue(1)
    const invalidate = jest.fn()
    const prisma = {
        course: {
            findFirst: jest.fn().mockResolvedValue({
                publishedAt: oldPublishedAt,
            }),
        },
    }
    const playlistService = {
        updatePlaylist: jest.fn().mockResolvedValue({
            id: 'course1',
            title: 'Guard Retention',
            publishedAt: newPublishedAt,
        }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return { notifyWorkspace, invalidate, prisma, playlistService, audit }
}

const run = (
    deps: ReturnType<typeof makeDeps>,
    payload: Record<string, unknown>,
) =>
    new UpdatePlaylistHandler(
        deps.playlistService as never,
        deps.audit as never,
        { invalidate: deps.invalidate } as never,
        deps.prisma as never,
        { notifyWorkspace: deps.notifyWorkspace } as never,
    ).execute(new UpdatePlaylistFeature(payload, 'w1', 'course1', 'coach1'))

const HOUR = 60 * 60 * 1000

describe('updatePlaylist — new-course push', () => {
    it('notifies the workspace when a draft becomes published now', async () => {
        const deps = makeDeps(null, new Date(Date.now() - HOUR).toISOString())
        await run(deps, { publishedAt: new Date(Date.now() - HOUR).toISOString() })

        expect(deps.notifyWorkspace).toHaveBeenCalledTimes(1)
        expect(deps.notifyWorkspace).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'w1',
                kind: 'course.published',
                refId: 'course1',
                category: 'newVideosEnabled',
                feature: 'videos',
                excludeUserId: 'coach1',
                metadata: { courseId: 'course1', title: 'Guard Retention' },
            }),
        )
    })

    it('does not notify when an already-published course is edited', async () => {
        const past = new Date(Date.now() - HOUR)
        const deps = makeDeps(past, past.toISOString())
        await run(deps, { title: 'Guard Retention v2' })

        expect(deps.notifyWorkspace).not.toHaveBeenCalled()
    })

    it('does not notify when a course is only scheduled for the future', async () => {
        const deps = makeDeps(null, new Date(Date.now() + HOUR).toISOString())
        await run(deps, { publishedAt: new Date(Date.now() + HOUR).toISOString() })

        expect(deps.notifyWorkspace).not.toHaveBeenCalled()
    })

    it('notifies when a scheduled course is brought forward to now', async () => {
        const deps = makeDeps(
            new Date(Date.now() + HOUR),
            new Date(Date.now() - HOUR).toISOString(),
        )
        await run(deps, { publishedAt: new Date(Date.now() - HOUR).toISOString() })

        expect(deps.notifyWorkspace).toHaveBeenCalledTimes(1)
    })

    it('always refreshes open course lists', async () => {
        const deps = makeDeps(null, null)
        await run(deps, { title: 'Draft edit' })

        expect(deps.invalidate).toHaveBeenCalledWith('w1', ['courses'])
        expect(deps.notifyWorkspace).not.toHaveBeenCalled()
    })
})
