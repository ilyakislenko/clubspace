import {
    claimDispatch,
    claimDispatchMany,
    releaseDispatch,
} from './dispatch-claims'

const make = () => ({
    notificationDispatchLog: {
        create: jest.fn().mockResolvedValue({}),
        createManyAndReturn: jest.fn().mockResolvedValue([{ refId: 'b' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
})

describe('dispatch claims', () => {
    it('claims a batch with one skip-duplicates insert and returns only the winners', async () => {
        const prisma = make()
        const won = await claimDispatchMany(prisma as never, 'k', ['a', 'b'])
        expect([...won]).toEqual(['b'])
        expect(prisma.notificationDispatchLog.createManyAndReturn).toHaveBeenCalledWith({
            data: [
                { kind: 'k', refId: 'a' },
                { kind: 'k', refId: 'b' },
            ],
            skipDuplicates: true,
            select: { refId: true },
        })
    })

    it('claims nothing for an empty batch without a query', async () => {
        const prisma = make()
        expect((await claimDispatchMany(prisma as never, 'k', [])).size).toBe(0)
        expect(prisma.notificationDispatchLog.createManyAndReturn).not.toHaveBeenCalled()
    })

    it('returns false for a key already taken, and rethrows anything else', async () => {
        const prisma = make()
        expect(await claimDispatch(prisma as never, 'k', 'a')).toBe(true)

        prisma.notificationDispatchLog.create.mockRejectedValueOnce(
            Object.assign(new Error('dup'), { code: 'P2002' }),
        )
        expect(await claimDispatch(prisma as never, 'k', 'a')).toBe(false)

        prisma.notificationDispatchLog.create.mockRejectedValueOnce(new Error('db down'))
        await expect(claimDispatch(prisma as never, 'k', 'a')).rejects.toThrow('db down')
    })

    it('releases a key', async () => {
        const prisma = make()
        await releaseDispatch(prisma as never, 'k', 'a')
        expect(prisma.notificationDispatchLog.deleteMany).toHaveBeenCalledWith({
            where: { kind: 'k', refId: 'a' },
        })
    })
})
