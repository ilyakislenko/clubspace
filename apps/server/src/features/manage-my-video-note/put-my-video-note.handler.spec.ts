import { ForbiddenError } from '../../shared/errors/shared.errors'
import { PutMyVideoNoteFeature } from './put-my-video-note.feature'
import { PutMyVideoNoteHandler } from './put-my-video-note.handler'

const build = (
    opts: { existing?: { text: string; updatedAt: Date } | null; membership?: unknown } = {},
) => {
    const prisma = {
        video: {
            findUnique: jest.fn().mockResolvedValue({ id: 'v1', workspaceId: 'w1' }),
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
        videoNote: {
            findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
            upsert: jest.fn(async ({ create }) => create),
        },
    }
    return { prisma }
}

const run = (prisma: unknown, text: string, updatedAt = '2026-01-03T00:00:00.000Z') =>
    new PutMyVideoNoteHandler(prisma as never).execute(
        new PutMyVideoNoteFeature('u1', 'v1', { text, updatedAt }),
    )

const STORED = { text: 'stored', updatedAt: new Date('2026-01-02T00:00:00Z') }

describe('PutMyVideoNoteHandler', () => {
    it('writes a note stamped with the video workspace and client updatedAt', async () => {
        const { prisma } = build()
        const res = await run(prisma, 'frames')
        expect(prisma.videoNote.upsert.mock.calls[0][0].create).toEqual({
            userId: 'u1',
            videoId: 'v1',
            workspaceId: 'w1',
            text: 'frames',
            updatedAt: new Date('2026-01-03T00:00:00Z'),
        })
        expect(res).toEqual({ text: 'frames', updatedAt: '2026-01-03T00:00:00.000Z' })
    })

    it('keeps the stored note when the client write is older (LWW)', async () => {
        const { prisma } = build({ existing: STORED })
        const res = await run(prisma, 'old', '2026-01-01T00:00:00.000Z')
        expect(prisma.videoNote.upsert).not.toHaveBeenCalled()
        expect(res).toEqual({ text: 'stored', updatedAt: '2026-01-02T00:00:00.000Z' })
    })

    it('overwrites when the client write is newer', async () => {
        const { prisma } = build({ existing: STORED })
        await run(prisma, 'new')
        expect(prisma.videoNote.upsert).toHaveBeenCalled()
    })

    it('clears the note by storing an empty-text tombstone', async () => {
        const { prisma } = build({ existing: STORED })
        const res = await run(prisma, '')
        expect(prisma.videoNote.upsert.mock.calls[0][0].update).toEqual({
            text: '',
            updatedAt: new Date('2026-01-03T00:00:00Z'),
        })
        expect(res).toEqual({ text: '', updatedAt: '2026-01-03T00:00:00.000Z' })
    })

    it('does not let an older empty write clear a newer note', async () => {
        const { prisma } = build({ existing: STORED })
        await run(prisma, '', '2026-01-01T00:00:00.000Z')
        expect(prisma.videoNote.upsert).not.toHaveBeenCalled()
    })

    it('does not resurrect a newer clear with an older offline edit', async () => {
        const cleared = { text: '', updatedAt: new Date('2026-01-02T00:00:00Z') }
        const { prisma } = build({ existing: cleared })
        const res = await run(prisma, 'old text', '2026-01-01T00:00:00.000Z')
        expect(prisma.videoNote.upsert).not.toHaveBeenCalled()
        expect(res).toEqual({ text: '', updatedAt: '2026-01-02T00:00:00.000Z' })
    })

    it('revives a cleared note with a newer edit', async () => {
        const cleared = { text: '', updatedAt: new Date('2026-01-02T00:00:00Z') }
        const { prisma } = build({ existing: cleared })
        await run(prisma, 'new text')
        expect(prisma.videoNote.upsert.mock.calls[0][0].update.text).toBe('new text')
    })

    it("rejects a user who isn't a member of the video's workspace", async () => {
        const { prisma } = build({ membership: null })
        await expect(run(prisma, 'x')).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.videoNote.upsert).not.toHaveBeenCalled()
    })
})
