import { Prisma } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ListMyVideoBookmarksFeature } from './list-my-video-bookmarks.feature'
import { ListMyVideoBookmarksHandler } from './list-my-video-bookmarks.handler'
import { PutMyVideoBookmarkFeature } from './put-my-video-bookmark.feature'
import { PutMyVideoBookmarkHandler } from './put-my-video-bookmark.handler'

const BM = '11111111-1111-4111-8111-111111111111'

type Stored = {
    id: string
    userId: string
    videoId: string
    workspaceId: string
    positionSec: number
    endSec: number | null
    label: string
    note: string
    drawing?: unknown
    createdAt: Date
    updatedAt: Date
    deletedAt: Date | null
}

const stored = (over: Partial<Stored> = {}): Stored => ({
    id: BM,
    userId: 'u1',
    videoId: 'v1',
    workspaceId: 'w1',
    positionSec: 10,
    endSec: null,
    label: 'stored',
    note: '',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    ...over,
})

const build = (
    opts: { existing?: Stored | null; video?: unknown; membership?: unknown } = {},
) => {
    const prisma = {
        video: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.video === undefined
                        ? { id: 'v1', workspaceId: 'w1' }
                        : opts.video,
                ),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ ownerId: null }) },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    opts.membership === undefined
                        ? { status: 'ACTIVE', accessUntil: null }
                        : opts.membership,
                ),
        },
        videoBookmark: {
            findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
            // Echo back what the handler wrote.
            create: jest.fn(async ({ data }) => ({ createdAt: new Date(), ...data })),
            update: jest.fn(async ({ data }) => ({ ...opts.existing, ...data })),
        },
    }
    return { prisma }
}

const body = (over: Record<string, unknown> = {}) => ({
    positionSec: 20,
    endSec: null as number | null,
    label: 'guard pass',
    note: 'hip out',
    updatedAt: '2026-01-03T00:00:00.000Z',
    deleted: false,
    ...over,
})

const put = (prisma: unknown, payload = body(), id = BM) =>
    new PutMyVideoBookmarkHandler(prisma as never).execute(
        new PutMyVideoBookmarkFeature('u1', 'v1', id, payload as never),
    )

describe('PutMyVideoBookmarkHandler', () => {
    it('creates a new bookmark with the client id, video workspace and client updatedAt', async () => {
        const { prisma } = build()
        const res = await put(prisma)
        expect(prisma.videoBookmark.create.mock.calls[0][0].data).toMatchObject({
            id: BM,
            userId: 'u1',
            videoId: 'v1',
            workspaceId: 'w1',
            positionSec: 20,
            updatedAt: new Date('2026-01-03T00:00:00Z'),
        })
        expect(res).toMatchObject({ id: BM, label: 'guard pass', endSec: null })
    })

    it('keeps the stored row when the client write is older (LWW)', async () => {
        const { prisma } = build({ existing: stored() })
        const res = await put(prisma, body({ updatedAt: '2026-01-01T12:00:00.000Z' }))
        expect(prisma.videoBookmark.update).not.toHaveBeenCalled()
        expect(prisma.videoBookmark.create).not.toHaveBeenCalled()
        expect(res).toMatchObject({ label: 'stored', positionSec: 10 })
    })

    it('overwrites the stored row when the client write is newer', async () => {
        const { prisma } = build({ existing: stored() })
        const res = await put(prisma)
        expect(prisma.videoBookmark.update).toHaveBeenCalled()
        expect(res).toMatchObject({
            label: 'guard pass',
            positionSec: 20,
            updatedAt: '2026-01-03T00:00:00.000Z',
        })
    })

    it.each([
        ['another user', { userId: 'u2' }],
        ['another video', { videoId: 'v2' }],
    ])('404s when the id belongs to %s', async (_, over) => {
        const { prisma } = build({ existing: stored(over) })
        await expect(put(prisma)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.videoBookmark.update).not.toHaveBeenCalled()
    })

    it.each([20, 5])('rejects endSec %i not after positionSec 20', async (endSec) => {
        const { prisma } = build()
        await expect(put(prisma, body({ endSec }))).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.videoBookmark.create).not.toHaveBeenCalled()
    })

    it('accepts an A–B segment', async () => {
        const { prisma } = build()
        const res = await put(prisma, body({ endSec: 45 }))
        expect(res.endSec).toBe(45)
    })

    it('404s for an unknown video', async () => {
        const { prisma } = build({ video: null })
        await expect(put(prisma)).rejects.toBeInstanceOf(NotFoundError)
    })

    it("rejects a user who isn't a member of the video's workspace", async () => {
        const { prisma } = build({ membership: null })
        await expect(put(prisma)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.videoBookmark.create).not.toHaveBeenCalled()
    })

    it('stores a delete as a tombstone stamped with the client time', async () => {
        const { prisma } = build({ existing: stored() })
        const res = await put(prisma, body({ deleted: true }))
        expect(prisma.videoBookmark.update.mock.calls[0][0].data).toMatchObject({
            deletedAt: new Date('2026-01-03T00:00:00Z'),
            updatedAt: new Date('2026-01-03T00:00:00Z'),
        })
        expect(res.deleted).toBe(true)
    })

    it('creates a tombstone for an id the server never saw', async () => {
        const { prisma } = build()
        const res = await put(prisma, body({ deleted: true }))
        expect(prisma.videoBookmark.create.mock.calls[0][0].data.deletedAt).toEqual(
            new Date('2026-01-03T00:00:00Z'),
        )
        expect(res.deleted).toBe(true)
    })

    it('does not resurrect a newer delete with an older offline edit', async () => {
        const tomb = stored({ deletedAt: new Date('2026-01-02T00:00:00Z') })
        const { prisma } = build({ existing: tomb })
        const res = await put(
            prisma,
            body({ deleted: false, updatedAt: '2026-01-01T12:00:00.000Z' }),
        )
        expect(prisma.videoBookmark.update).not.toHaveBeenCalled()
        expect(res.deleted).toBe(true)
    })

    it('revives a deleted bookmark with a newer edit', async () => {
        const tomb = stored({ deletedAt: new Date('2026-01-02T00:00:00Z') })
        const { prisma } = build({ existing: tomb })
        const res = await put(prisma, body({ deleted: false }))
        expect(prisma.videoBookmark.update.mock.calls[0][0].data.deletedAt).toBeNull()
        expect(res).toMatchObject({ deleted: false, label: 'guard pass' })
    })

    const drawing = {
        strokes: [{ tool: 'arrow', color: 'red', points: [0.1, 0.2, 0.5, 0.6] }],
    }

    it('stores and returns a drawing', async () => {
        const { prisma } = build()
        const res = await put(prisma, body({ drawing }))
        expect(prisma.videoBookmark.create.mock.calls[0][0].data.drawing).toEqual(
            drawing,
        )
        expect(res.drawing).toEqual(drawing)
    })

    it('keeps the stored drawing when a client omits the field', async () => {
        const { prisma } = build({ existing: stored({ drawing }) })
        const res = await put(prisma)
        expect(prisma.videoBookmark.update.mock.calls[0][0].data).not.toHaveProperty(
            'drawing',
        )
        expect(res.drawing).toEqual(drawing)
    })

    it('clears the drawing on an explicit null', async () => {
        const { prisma } = build({ existing: stored({ drawing }) })
        await put(prisma, body({ drawing: null }))
        expect(prisma.videoBookmark.update.mock.calls[0][0].data.drawing).toBe(
            Prisma.DbNull,
        )
    })

    it('serializes an unreadable stored drawing as none', async () => {
        const { prisma } = build({
            existing: stored({ drawing: { strokes: 'garbage' } }),
        })
        const res = await put(prisma, body({ updatedAt: '2026-01-01T12:00:00.000Z' }))
        expect(res.drawing).toBeNull()
    })
})

describe('ListMyVideoBookmarksHandler', () => {
    it('omits deleted bookmarks', async () => {
        const rows = [
            stored({ id: 'a', label: 'live' }),
            stored({ id: 'b', label: 'gone', deletedAt: new Date() }),
        ]
        const { prisma } = build()
        const findMany = jest.fn(async ({ where }) =>
            rows.filter(
                (r) =>
                    r.userId === where.userId &&
                    r.videoId === where.videoId &&
                    (where.deletedAt !== null || r.deletedAt === null),
            ),
        )
        const res = await new ListMyVideoBookmarksHandler({
            ...prisma,
            videoBookmark: { findMany },
        } as never).execute(new ListMyVideoBookmarksFeature('u1', 'v1'))
        expect(res.items.map((i) => i.label)).toEqual(['live'])
    })
})
