import { NotFoundError, UnexpectedError } from '../../shared/errors/shared.errors'
import { ensureJoinCode, rotateJoinCode } from './join-code.store'

const prismaError = (code: string) =>
    Object.assign(new Error(code), { code })

const build = () => {
    const findUnique = jest.fn()
    const create = jest.fn()
    const update = jest.fn()
    const prisma = { workspaceJoinCode: { findUnique, create, update } }
    return { prisma: prisma as never, findUnique, create, update }
}

describe('ensureJoinCode', () => {
    it('returns the stored code without writing', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue({ code: 'ABCD2345' })
        await expect(ensureJoinCode(prisma, 'w1')).resolves.toBe('ABCD2345')
        expect(create).not.toHaveBeenCalled()
    })

    it('creates the row when none exists', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockResolvedValue({})
        const code = await ensureJoinCode(prisma, 'w1')
        expect(create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            code,
        })
        expect(code).toMatch(/^[2-9A-Z]{8}$/)
    })

    it('404s on a missing club (foreign key)', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockRejectedValue(prismaError('P2003'))
        await expect(ensureJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('returns the concurrent winner’s code on a primary-key collision', async () => {
        const { prisma, findUnique, create } = build()
        findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ code: 'WINNER23' })
        create.mockRejectedValue(prismaError('P2002'))
        await expect(ensureJoinCode(prisma, 'w1')).resolves.toBe('WINNER23')
        expect(create).toHaveBeenCalledTimes(1)
    })

    it('draws again when the code belongs to another club', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create
            .mockRejectedValueOnce(prismaError('P2002'))
            .mockRejectedValueOnce(prismaError('P2002'))
            .mockResolvedValueOnce({})
        await expect(ensureJoinCode(prisma, 'w1')).resolves.toMatch(
            /^[2-9A-Z]{8}$/,
        )
        expect(create).toHaveBeenCalledTimes(3)
    })

    it('rethrows an error that is not a collision', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockRejectedValue(new Error('boom'))
        await expect(ensureJoinCode(prisma, 'w1')).rejects.toThrow('boom')
        expect(create).toHaveBeenCalledTimes(1)
    })

    it('gives up after 5 colliding attempts', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockRejectedValue(prismaError('P2002'))
        await expect(ensureJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            UnexpectedError,
        )
        expect(create).toHaveBeenCalledTimes(5)
    })
})

describe('rotateJoinCode', () => {
    it('updates the row keyed by the club', async () => {
        const { prisma, findUnique, update } = build()
        findUnique.mockResolvedValue({ code: 'OLD22222' })
        update.mockResolvedValue({})
        const code = await rotateJoinCode(prisma, 'w1')
        expect(update.mock.calls[0][0]).toEqual({
            where: { workspaceId: 'w1' },
            data: { code },
        })
        expect(code).not.toBe('OLD22222')
    })

    it('creates the row first when the club never had a code', async () => {
        const { prisma, findUnique, create, update } = build()
        findUnique.mockResolvedValue(null)
        create.mockResolvedValue({})
        update.mockResolvedValue({})
        await rotateJoinCode(prisma, 'w1')
        expect(create).toHaveBeenCalledTimes(1)
        expect(update).toHaveBeenCalledTimes(1)
    })

    it('retries when the code collides with another club', async () => {
        const { prisma, findUnique, update } = build()
        findUnique.mockResolvedValue({ code: 'OLD22222' })
        update
            .mockRejectedValueOnce(prismaError('P2002'))
            .mockRejectedValueOnce(prismaError('P2002'))
            .mockResolvedValueOnce({})
        await expect(rotateJoinCode(prisma, 'w1')).resolves.toMatch(
            /^[2-9A-Z]{8}$/,
        )
        expect(update).toHaveBeenCalledTimes(3)
    })

    it('rethrows an error that is not a collision', async () => {
        const { prisma, findUnique, update } = build()
        findUnique.mockResolvedValue({ code: 'OLD22222' })
        update.mockRejectedValue(new Error('boom'))
        await expect(rotateJoinCode(prisma, 'w1')).rejects.toThrow('boom')
        expect(update).toHaveBeenCalledTimes(1)
    })

    it('404s when the club vanished', async () => {
        const { prisma, findUnique, update } = build()
        findUnique.mockResolvedValue({ code: 'OLD22222' })
        update.mockRejectedValue(prismaError('P2025'))
        await expect(rotateJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('gives up after 5 colliding attempts', async () => {
        const { prisma, findUnique, update } = build()
        findUnique.mockResolvedValue({ code: 'OLD22222' })
        update.mockRejectedValue(prismaError('P2002'))
        await expect(rotateJoinCode(prisma, 'w1')).rejects.toBeInstanceOf(
            UnexpectedError,
        )
        expect(update).toHaveBeenCalledTimes(5)
    })
})
