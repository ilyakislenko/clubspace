import { ListMyFavoritesFeature } from './list-my-favorites.feature'
import { ListMyFavoritesHandler } from './list-my-favorites.handler'

const makePrisma = (videosEnabled: boolean) => ({
    workspace: { findUnique: jest.fn().mockResolvedValue({ videosEnabled }) },
    videoFavorite: {
        findMany: jest.fn().mockResolvedValue([
            {
                videoId: 'v1',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                video: {
                    id: 'v1',
                    title: 'Armbar',
                    duration: 60,
                    thumbnailUrl: null,
                    status: 'ready',
                },
            },
        ]),
    },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (prisma: any) =>
    new ListMyFavoritesHandler(prisma).execute(
        new ListMyFavoritesFeature('u1', 'w1'),
    )

describe('listMyFavorites', () => {
    it('returns the member’s favorites when videos are on', async () => {
        const out = await run(makePrisma(true))
        expect(out.data).toHaveLength(1)
        expect(out.data[0].videoId).toBe('v1')
    })

    it('returns an empty list, not an error, when videos are off', async () => {
        const prisma = makePrisma(false)
        const out = await run(prisma)
        expect(out).toEqual({ data: [] })
        expect(prisma.videoFavorite.findMany).not.toHaveBeenCalled()
    })
})
