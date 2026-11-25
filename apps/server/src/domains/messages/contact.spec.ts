import { dropMessageContact } from './contact'

const make = (deleted = 1) => ({
    prisma: { memberRetentionContact: { deleteMany: jest.fn().mockResolvedValue({ count: deleted }) } },
    callLists: { invalidate: jest.fn().mockResolvedValue(undefined) },
})

describe('dropMessageContact', () => {
    it('removes the contact of this club and puts the member back on the call list', async () => {
        const { prisma, callLists } = make()
        await dropMessageContact(prisma as never, callLists, { workspaceId: 'w1', contactId: 'c1' })
        expect(prisma.memberRetentionContact.deleteMany).toHaveBeenCalledWith({
            where: { id: 'c1', workspaceId: 'w1' },
        })
        expect(callLists.invalidate).toHaveBeenCalledWith('w1')
    })

    it('does nothing for a message that logged no contact', async () => {
        const { prisma, callLists } = make()
        await dropMessageContact(prisma as never, callLists, { workspaceId: 'w1', contactId: null })
        expect(prisma.memberRetentionContact.deleteMany).not.toHaveBeenCalled()
        expect(callLists.invalidate).not.toHaveBeenCalled()
    })

    it('keeps the cache when the contact was already gone', async () => {
        const { prisma, callLists } = make(0)
        await dropMessageContact(prisma as never, callLists, { workspaceId: 'w1', contactId: 'c1' })
        expect(callLists.invalidate).not.toHaveBeenCalled()
    })
})
