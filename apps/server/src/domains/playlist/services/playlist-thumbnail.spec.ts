import { BadRequestError, NotFoundError } from '../../../shared/errors/shared.errors'
import { PlaylistService } from './playlist.service'

// L5: a course cover must be one this service issued for the same course in
// our own bucket — never an arbitrary URL rendered in every member's app.

const COURSE = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const FILE = '33333333-3333-4333-8333-333333333333'
const BASE = 'https://s3.example.ru/clubspace/'

const build = (existing: { id: string } | null = { id: COURSE }) => {
    const prisma = {
        course: {
            findFirst: jest.fn().mockResolvedValue(existing),
            update: jest.fn(),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('clubspace'),
        getPublicObjectUrl: jest.fn(
            ({ key }: { bucket: string; key: string }) => `${BASE}${key}`,
        ),
    }
    return { service: new PlaylistService(prisma as never, files as never), prisma }
}

const update = (service: PlaylistService, thumbnailUrl: string | null) =>
    service.updatePlaylist({
        workspaceId: 'w1',
        playlistId: COURSE,
        data: { thumbnailUrl },
    })

describe('PlaylistService.updatePlaylist thumbnailUrl', () => {
    it('refuses a course from another club', async () => {
        const { service } = build(null)
        await expect(
            update(service, `${BASE}thumbnails/playlists/${COURSE}/${FILE}`),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each([
        'https://evil.example/pixel.gif',
        `${BASE}raw/${COURSE}/source.mp4`,
        `${BASE}thumbnails/playlists/${OTHER}/${FILE}`,
        `${BASE}thumbnails/${COURSE}/${FILE}`,
    ])('refuses %s', async (url) => {
        const { service, prisma } = build()
        await expect(update(service, url)).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.course.update).not.toHaveBeenCalled()
    })

    it('accepts a cover uploaded for this course', async () => {
        const { service, prisma } = build()
        const url = `${BASE}thumbnails/playlists/${COURSE}/${FILE}`
        await update(service, url).catch(() => undefined)
        expect(prisma.course.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ thumbnailUrl: url }),
            }),
        )
    })

    it('accepts clearing the cover', async () => {
        const { service, prisma } = build()
        await update(service, null).catch(() => undefined)
        expect(prisma.course.update).toHaveBeenCalled()
    })
})
