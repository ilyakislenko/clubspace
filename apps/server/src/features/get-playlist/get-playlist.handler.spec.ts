jest.mock('../../domains/playlist/services/playlist.service', () => ({
    PlaylistService: class {},
}))
jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import {
    ModuleNotEntitledError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ListPlaylistsFeature } from '../get-playlists/list-playlists.feature'
import { ListPlaylistsHandler } from '../get-playlists/list-playlists.handler'
import { GetPlaylistFeature } from './get-playlist.feature'
import { GetPlaylistHandler } from './get-playlist.handler'

// Who sees what is decided by the viewer these handlers load and hand to
// PlaylistService (rules: course-audience.spec / playlist.service.spec).
const VIEWER = { isStaff: false }

const build = (o: { notFound?: boolean; videosOpen?: boolean } = {}) => {
    const courseAccess = {
        loadViewer: jest.fn().mockResolvedValue(VIEWER),
        videosOpenToMembers: jest.fn().mockResolvedValue(o.videosOpen ?? true),
    }
    const playlistService = {
        getPlaylist: o.notFound
            ? jest.fn().mockRejectedValue(new NotFoundError({ message: 'Курс не найден' }))
            : jest.fn().mockResolvedValue({ id: 'c1' }),
        listPlaylists: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    }
    return { courseAccess, playlistService }
}

describe('GetPlaylistHandler', () => {
    const run = (deps: ReturnType<typeof build>, isStaff: boolean) =>
        new GetPlaylistHandler(
            deps.playlistService as never,
            deps.courseAccess as never,
        ).execute(new GetPlaylistFeature('ws-1', 'c1', 'u1', isStaff))

    it('loads the student viewer and their own progression', async () => {
        const deps = build()
        await run(deps, false)
        expect(deps.courseAccess.loadViewer).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: false,
        })
        expect(deps.playlistService.getPlaylist).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            playlistId: 'c1',
            viewer: VIEWER,
            userId: 'u1',
        })
    })

    it('passes the staff flag through', async () => {
        const deps = build()
        await run(deps, true)
        expect(deps.courseAccess.loadViewer.mock.calls[0][0].isStaff).toBe(true)
    })

    it('surfaces a hidden or missing course as 404', async () => {
        const deps = build({ notFound: true })
        await expect(run(deps, false)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses a student while the club video section / VIDEO module is off', async () => {
        const deps = build({ videosOpen: false })
        await expect(run(deps, false)).rejects.toBeInstanceOf(ModuleNotEntitledError)
        expect(deps.playlistService.getPlaylist).not.toHaveBeenCalled()
    })

    it('still opens the course for staff when videos are off', async () => {
        const deps = build({ videosOpen: false })
        await expect(run(deps, true)).resolves.toEqual({ id: 'c1' })
    })
})

describe('ListPlaylistsHandler', () => {
    it('lists with the viewer loaded for the caller', async () => {
        const deps = build()
        await new ListPlaylistsHandler(
            deps.playlistService as never,
            deps.courseAccess as never,
        ).execute(new ListPlaylistsFeature({ q: 'гард' }, 'ws-1', 'u1', false))
        expect(deps.courseAccess.loadViewer).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            userId: 'u1',
            isStaff: false,
        })
        expect(deps.playlistService.listPlaylists).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            curPage: undefined,
            perPage: undefined,
            q: 'гард',
            viewer: VIEWER,
        })
    })

    it('lists nothing to a student while videos are off; staff still list', async () => {
        const deps = build({ videosOpen: false })
        const handler = new ListPlaylistsHandler(
            deps.playlistService as never,
            deps.courseAccess as never,
        )
        await expect(
            handler.execute(new ListPlaylistsFeature({}, 'ws-1', 'u1', false)),
        ).resolves.toEqual({ data: [], total: 0, curPage: 1, perPage: 20 })
        expect(deps.playlistService.listPlaylists).not.toHaveBeenCalled()

        await handler.execute(new ListPlaylistsFeature({}, 'ws-1', 'u1', true))
        expect(deps.playlistService.listPlaylists).toHaveBeenCalledTimes(1)
    })
})
