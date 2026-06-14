import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { SaveVideoProgressFeature } from './save-video-progress.feature'
import { SaveVideoProgressHandler } from './save-video-progress.handler'

type BuildOpts = {
    video?: { id: string; workspaceId: string; duration: number | null } | null
    membership?: { status: string; accessUntil: Date | null } | null
    ownerId?: string | null
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
        videoWatched: {
            upsert: jest.fn().mockResolvedValue({
                position: 10,
                completed: false,
                watchedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
        },
    }
    const handler = new SaveVideoProgressHandler(prisma as never)
    return { handler, prisma }
}

const run = (
    handler: SaveVideoProgressHandler,
    payload: Record<string, unknown> = {},
) => handler.execute(new SaveVideoProgressFeature('u1', 'v1', payload) as never)

describe('SaveVideoProgressHandler', () => {
    it("rejects a user who isn't a member of the video's workspace", async () => {
        const { handler, prisma } = build({ membership: null })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.videoWatched.upsert).not.toHaveBeenCalled()
        // and must not back-fill another workspace's video metadata
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('rejects a member whose access window has expired', async () => {
        const { handler, prisma } = build({
            membership: { status: 'ACTIVE', accessUntil: new Date('2000-01-01') },
        })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
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
})
