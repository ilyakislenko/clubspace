import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { MovePlaylistVideoHandler } from './move-playlist-video.handler'

// Builds a handler over a mocked prisma whose courseVideo table is `rows`
// (in stored order). `$transaction` runs the callback against a tx that
// records every order write, so a test can assert the final ordering.
const build = (rows: string[], opts: { playlistExists?: boolean } = {}) => {
    const writes: Record<string, number> = {}
    const tx = {
        courseVideo: {
            findMany: jest
                .fn()
                .mockResolvedValue(rows.map((videoId) => ({ videoId }))),
            update: jest.fn().mockImplementation((args) => {
                writes[args.where.courseId_videoId.videoId] = args.data.order
                return Promise.resolve()
            }),
        },
    }
    const prisma = {
        course: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    opts.playlistExists === false ? null : { id: 'p1' },
                ),
        },
        $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new MovePlaylistVideoHandler(prisma as never, audit as never)
    return { handler, writes }
}

const run = (
    handler: MovePlaylistVideoHandler,
    videoId: string,
    payload: { afterId?: string | null; beforeId?: string | null },
) =>
    handler.execute({
        payload,
        workspaceId: 'w1',
        playlistId: 'p1',
        videoId,
        invokerUserId: 'u1',
    } as never)

describe('MovePlaylistVideoHandler', () => {
    it('rejects when neither afterId nor beforeId is given', async () => {
        const { handler } = build(['a', 'b', 'c'])
        await expect(run(handler, 'c', {})).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('404s when the playlist is not in the workspace', async () => {
        const { handler } = build(['a'], { playlistExists: false })
        await expect(
            run(handler, 'a', { afterId: null }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s when the video is not attached to the playlist', async () => {
        const { handler } = build(['a', 'b'])
        await expect(
            run(handler, 'zzz', { afterId: null }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('rejects a neighbour equal to the moved video', async () => {
        const { handler } = build(['a', 'b'])
        await expect(run(handler, 'a', { afterId: 'a' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it('rejects a neighbour not in the playlist', async () => {
        const { handler } = build(['a', 'b'])
        await expect(
            run(handler, 'a', { beforeId: 'ghost' }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('afterId=null moves to the top and reindexes 0..n', async () => {
        const { handler, writes } = build(['a', 'b', 'c'])
        const res = await run(handler, 'c', { afterId: null })
        expect(writes).toEqual({ c: 0, a: 1, b: 2 })
        expect(res).toEqual({ videoId: 'c', order: 0 })
    })

    it('beforeId=null moves to the end', async () => {
        const { handler, writes } = build(['a', 'b', 'c'])
        const res = await run(handler, 'a', { beforeId: null })
        expect(writes).toEqual({ b: 0, c: 1, a: 2 })
        expect(res).toEqual({ videoId: 'a', order: 2 })
    })

    it('afterId=<id> inserts directly after that neighbour', async () => {
        const { handler, writes } = build(['a', 'b', 'c'])
        await run(handler, 'c', { afterId: 'a' })
        expect(writes).toEqual({ a: 0, c: 1, b: 2 })
    })

    it('beforeId=<id> inserts directly before that neighbour', async () => {
        const { handler, writes } = build(['a', 'b', 'c'])
        await run(handler, 'a', { beforeId: 'c' })
        expect(writes).toEqual({ b: 0, a: 1, c: 2 })
    })
})
