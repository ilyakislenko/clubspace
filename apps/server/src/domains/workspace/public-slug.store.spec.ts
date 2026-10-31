import { NotFoundError, UnexpectedError } from '../../shared/errors/shared.errors'
import { ensurePublicSlug } from './public-slug.store'

const prismaError = (code: string) => Object.assign(new Error(code), { code })

const build = () => {
    const findUnique = jest.fn()
    const findMany = jest.fn().mockResolvedValue([])
    const create = jest.fn().mockResolvedValue({})
    const prisma = { workspacePublicSlug: { findUnique, findMany, create } }
    return { prisma: prisma as never, findUnique, findMany, create }
}

const club = { id: 'w1', name: 'Академия БЖЖ' }

describe('ensurePublicSlug', () => {
    it('returns the stored slug without writing', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue({ slug: 'my-club' })
        await expect(ensurePublicSlug(prisma, club)).resolves.toBe('my-club')
        expect(create).not.toHaveBeenCalled()
    })

    it('generates the slug from the name', async () => {
        const { prisma, findUnique, findMany, create } = build()
        findUnique.mockResolvedValue(null)
        await expect(ensurePublicSlug(prisma, club)).resolves.toBe(
            'akademiya-bzhzh',
        )
        expect(findMany.mock.calls[0][0].where).toEqual({
            slug: { startsWith: 'akademiya-bzhzh' },
        })
        expect(create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            slug: 'akademiya-bzhzh',
        })
    })

    it('suffixes past another club with the same name', async () => {
        const { prisma, findUnique, findMany } = build()
        findUnique.mockResolvedValue(null)
        findMany.mockResolvedValue([{ slug: 'akademiya-bzhzh' }])
        await expect(ensurePublicSlug(prisma, club)).resolves.toBe(
            'akademiya-bzhzh-2',
        )
    })

    it('404s on a missing club (foreign key)', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockRejectedValue(prismaError('P2003'))
        await expect(ensurePublicSlug(prisma, club)).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('returns the concurrent winner’s slug on a primary-key collision', async () => {
        const { prisma, findUnique, create } = build()
        findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ slug: 'winner' })
        create.mockRejectedValue(prismaError('P2002'))
        await expect(ensurePublicSlug(prisma, club)).resolves.toBe('winner')
    })

    it('retries when another club took the slug in between', async () => {
        const { prisma, findUnique, findMany, create } = build()
        findUnique.mockResolvedValue(null)
        findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ slug: 'akademiya-bzhzh' }])
        create.mockRejectedValueOnce(prismaError('P2002')).mockResolvedValue({})
        await expect(ensurePublicSlug(prisma, club)).resolves.toBe(
            'akademiya-bzhzh-2',
        )
    })

    it('gives up after repeated collisions', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockRejectedValue(prismaError('P2002'))
        await expect(ensurePublicSlug(prisma, club)).rejects.toBeInstanceOf(
            UnexpectedError,
        )
    })

    it('rethrows unrelated database errors', async () => {
        const { prisma, findUnique, create } = build()
        findUnique.mockResolvedValue(null)
        create.mockRejectedValue(new Error('db down'))
        await expect(ensurePublicSlug(prisma, club)).rejects.toThrow('db down')
    })
})
