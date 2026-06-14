import { ForbiddenError } from '../../shared/errors/shared.errors'
import { SetVideoFavoriteFeature } from './set-video-favorite.feature'
import { SetVideoFavoriteHandler } from './set-video-favorite.handler'

type BuildOpts = {
    membership?: { status: string; accessUntil: Date | null } | null
    ownerId?: string | null
}

const build = (opts: BuildOpts = {}) => {
    const prisma = {
        video: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'v1', workspaceId: 'w1' }),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: opts.ownerId ?? null }),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.membership === undefined
                        ? { status: 'ACTIVE', accessUntil: null }
                        : opts.membership,
                ),
        },
        videoFavorite: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    const handler = new SetVideoFavoriteHandler(prisma as never)
    return { handler, prisma }
}

const run = (handler: SetVideoFavoriteHandler, favorite: boolean) =>
    handler.execute(new SetVideoFavoriteFeature('u1', 'v1', { favorite }) as never)

describe('SetVideoFavoriteHandler', () => {
    it("rejects a user who isn't a member of the video's workspace", async () => {
        const { handler, prisma } = build({ membership: null })
        await expect(run(handler, true)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.videoFavorite.upsert).not.toHaveBeenCalled()
        expect(prisma.videoFavorite.deleteMany).not.toHaveBeenCalled()
    })

    it('favorites for an active member', async () => {
        const { handler, prisma } = build()
        await run(handler, true)
        expect(prisma.videoFavorite.upsert).toHaveBeenCalled()
    })

    it('unfavorites for an active member', async () => {
        const { handler, prisma } = build()
        await run(handler, false)
        expect(prisma.videoFavorite.deleteMany).toHaveBeenCalledWith({
            where: { userId: 'u1', videoId: 'v1' },
        })
    })
})
