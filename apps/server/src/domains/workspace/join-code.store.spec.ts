import { NotFoundError, UnexpectedError } from '../../shared/errors/shared.errors'
import { assignNewJoinCode, ensureJoinCode } from './join-code.store'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })

const build = () => {
    const findUnique = jest.fn()
    const updateMany = jest.fn()
    const prisma = { workspace: { findUnique, updateMany } }
    return { prisma: prisma as never, findUnique, updateMany }
}

describe('ensureJoinCode', () => {
    it('returns the stored code without writing', async () => {
        const { prisma, findUnique, updateMany } = build()
        findUnique.mockResolvedValue({ joinCode: 'ABCD2345' })
        await expect(ensureJoinCode(prisma, 'w1')).resolves.toBe('ABCD2345')
        expect(updateMany).not.toHaveBeenCalled()
    })

    it('404s on a missing club', async () => {
        const { prisma, findUnique } = build()
        findUnique.mockResolvedValue(null)
        await expect(ensureJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('assigns a code only into an empty slot when none is set', async () => {
        const { prisma, findUnique, updateMany } = build()
        findUnique.mockResolvedValue({ joinCode: null })
        updateMany.mockResolvedValue({ count: 1 })
        const code = await ensureJoinCode(prisma, 'w1')
        const args = updateMany.mock.calls[0][0]
        expect(args.where).toEqual({ id: 'w1', joinCode: null })
        expect(args.data).toEqual({ joinCode: code })
        expect(code).toMatch(/^[2-9A-Z]{8}$/)
    })
})

describe('assignNewJoinCode', () => {
    it('overwrites regardless of the current value when rotating', async () => {
        const { prisma, updateMany } = build()
        updateMany.mockResolvedValue({ count: 1 })
        await assignNewJoinCode(prisma, 'w1')
        expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'w1' })
    })

    it('retries when the code collides with another club', async () => {
        const { prisma, updateMany } = build()
        updateMany
            .mockRejectedValueOnce(p2002())
            .mockRejectedValueOnce(p2002())
            .mockResolvedValueOnce({ count: 1 })
        await expect(assignNewJoinCode(prisma, 'w1')).resolves.toMatch(
            /^[2-9A-Z]{8}$/,
        )
        expect(updateMany).toHaveBeenCalledTimes(3)
        const codes = updateMany.mock.calls.map((c) => c[0].data.joinCode)
        expect(codes.every((c: string) => /^[2-9A-Z]{8}$/.test(c))).toBe(true)
    })

    it('rethrows an error that is not a collision', async () => {
        const { prisma, updateMany } = build()
        updateMany.mockRejectedValue(new Error('boom'))
        await expect(assignNewJoinCode(prisma, 'w1')).rejects.toThrow('boom')
        expect(updateMany).toHaveBeenCalledTimes(1)
    })

    it('returns the concurrent winner’s code when the slot was just filled', async () => {
        const { prisma, findUnique, updateMany } = build()
        updateMany.mockResolvedValue({ count: 0 })
        findUnique.mockResolvedValue({ joinCode: 'WINNER23' })
        await expect(
            assignNewJoinCode(prisma, 'w1', { onlyIfNull: true }),
        ).resolves.toBe('WINNER23')
    })

    it('404s when the club vanished (nothing updated, nothing to re-read)', async () => {
        const { prisma, findUnique, updateMany } = build()
        updateMany.mockResolvedValue({ count: 0 })
        findUnique.mockResolvedValue(null)
        await expect(
            assignNewJoinCode(prisma, 'w1', { onlyIfNull: true }),
        ).rejects.toBeInstanceOf(NotFoundError)
        await expect(assignNewJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('gives up after 5 colliding attempts', async () => {
        const { prisma, updateMany } = build()
        updateMany.mockRejectedValue(p2002())
        await expect(assignNewJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            UnexpectedError,
        )
        expect(updateMany).toHaveBeenCalledTimes(5)
    })
})
