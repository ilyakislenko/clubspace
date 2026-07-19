import { NotFoundError } from '../../shared/errors/shared.errors'
import { UpdateMemberNotesFeature } from './update-member-notes.feature'
import { UpdateMemberNotesHandler } from './update-member-notes.handler'

const build = (membership: { id: string } | null) => {
    const update = jest.fn().mockResolvedValue({})
    const record = jest.fn().mockResolvedValue(undefined)
    const prisma = {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(membership),
            update,
        },
    }
    const handler = new UpdateMemberNotesHandler(
        prisma as never,
        { record } as never,
    )
    return { handler, update, record }
}

const run = (handler: UpdateMemberNotesHandler, notes: string | null) =>
    handler.execute(
        new UpdateMemberNotesFeature({ notes }, 'w1', 'u1', 'admin1'),
    )

describe('updateMemberNotes', () => {
    it('saves a note for a member', async () => {
        const { handler, update } = build({ id: 'm1' })
        const res = await run(handler, 'wants to compete')
        expect(update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { notes: 'wants to compete' },
        })
        expect(res).toEqual({ userId: 'u1', notes: 'wants to compete' })
    })

    it('normalises blank/whitespace to null', async () => {
        const { handler, update } = build({ id: 'm1' })
        const res = await run(handler, '   ')
        expect(update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { notes: null },
        })
        expect(res.notes).toBeNull()
    })

    it('clears the note on null', async () => {
        const { handler, update } = build({ id: 'm1' })
        await run(handler, null)
        expect(update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { notes: null },
        })
    })

    it('404s a user who is not a member of this workspace', async () => {
        const { handler, update } = build(null)
        await expect(run(handler, 'x')).rejects.toBeInstanceOf(NotFoundError)
        expect(update).not.toHaveBeenCalled()
    })

    it('audits the change but never logs the note content', async () => {
        const { handler, record } = build({ id: 'm1' })
        await run(handler, 'private injury detail')
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.updateNotes',
                targetId: 'u1',
                actorId: 'admin1',
            }),
        )
        const meta = record.mock.calls[0][0].metadata
        expect(JSON.stringify(meta)).not.toContain('private injury detail')
    })
})
