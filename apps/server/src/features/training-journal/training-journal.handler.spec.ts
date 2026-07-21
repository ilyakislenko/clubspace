import { NotFoundError } from '../../shared/errors/shared.errors'
import { CreateJournalEntryFeature } from './create-journal-entry.feature'
import { CreateJournalEntryHandler } from './create-journal-entry.handler'
import { DeleteJournalEntryFeature } from './delete-journal-entry.feature'
import { DeleteJournalEntryHandler } from './delete-journal-entry.handler'
import { ListJournalFeature } from './list-journal.feature'
import { ListJournalHandler } from './list-journal.handler'

const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'e1',
    entryDate: new Date('2026-07-20T00:00:00Z'),
    body: 'worked on triangle',
    createdAt: new Date('2026-07-20T18:00:00Z'),
    updatedAt: new Date('2026-07-20T18:00:00Z'),
    ...over,
})

describe('createJournalEntry', () => {
    it('trims the body and defaults the date to today, scoped to the member', async () => {
        const create = jest.fn().mockResolvedValue(row())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { trainingJournalEntry: { create } }
        await new CreateJournalEntryHandler(prisma).execute(
            new CreateJournalEntryFeature({ body: '  hi  ' }, 'w1', 'u1'),
        )
        const data = create.mock.calls[0][0].data
        expect(data.workspaceId).toBe('w1')
        expect(data.userId).toBe('u1')
        expect(data.body).toBe('hi')
        expect(data.entryDate).toBeInstanceOf(Date)
    })

    it('honours an explicit entryDate', async () => {
        const create = jest.fn().mockResolvedValue(row())
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { trainingJournalEntry: { create } }
        await new CreateJournalEntryHandler(prisma).execute(
            new CreateJournalEntryFeature(
                { body: 'x', entryDate: '2026-06-15' },
                'w1',
                'u1',
            ),
        )
        expect(create.mock.calls[0][0].data.entryDate.toISOString()).toBe(
            '2026-06-15T00:00:00.000Z',
        )
    })
})

describe('deleteJournalEntry', () => {
    it('deletes only the caller’s own entry', async () => {
        const deleteMany = jest.fn().mockResolvedValue({ count: 1 })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { trainingJournalEntry: { deleteMany } }
        const out = await new DeleteJournalEntryHandler(prisma).execute(
            new DeleteJournalEntryFeature('w1', 'u1', 'e1'),
        )
        expect(deleteMany).toHaveBeenCalledWith({
            where: { id: 'e1', workspaceId: 'w1', userId: 'u1' },
        })
        expect(out.status).toBe('deleted')
    })

    it('404s when nothing matched (not owned / missing)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = {
            trainingJournalEntry: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        }
        await expect(
            new DeleteJournalEntryHandler(prisma).execute(
                new DeleteJournalEntryFeature('w1', 'u1', 'nope'),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('listJournal', () => {
    it('queries the member’s own entries newest-first with counts', async () => {
        const findMany = jest.fn().mockResolvedValue([row()])
        const count = jest.fn().mockResolvedValue(1)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prisma: any = { trainingJournalEntry: { findMany, count } }
        const out = await new ListJournalHandler(prisma).execute(
            new ListJournalFeature({}, 'w1', 'u1'),
        )
        expect(findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'u1',
        })
        expect(out.total).toBe(1)
        expect(out.entries[0]).toMatchObject({ id: 'e1', entryDate: '2026-07-20' })
    })
})
