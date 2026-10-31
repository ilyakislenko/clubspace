import {
    SearchPublicClubsFeature,
    SearchPublicClubsFeatureInputSchema,
} from './search-public-clubs.feature'
import { SearchPublicClubsHandler } from './search-public-clubs.handler'

const build = () => {
    const prisma = {
        workspacePublicSlug: {
            findMany: jest.fn().mockResolvedValue([
                {
                    slug: 'akademiya-bzhzh',
                    workspace: {
                        name: 'Академия БЖЖ',
                        type: 'GRAPPLING',
                        city: 'Томск',
                        publicDescription: 'Зал у реки',
                        logoKey: 'workspaces/w1/logo/x',
                    },
                },
                {
                    slug: 'yoga-tomsk',
                    workspace: {
                        name: 'Йога',
                        type: 'YOGA',
                        city: null,
                        publicDescription: null,
                        logoKey: null,
                    },
                },
            ]),
            count: jest.fn().mockResolvedValue(42),
        },
        workspace: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ city: 'Москва' }, { city: 'Томск' }]),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('bucket'),
        getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3/logo'),
    }
    const handler = new SearchPublicClubsHandler(prisma as never, files as never)
    return { handler, prisma }
}

const search = (handler: SearchPublicClubsHandler, query: object = {}) =>
    handler.execute(
        new SearchPublicClubsFeature(
            SearchPublicClubsFeatureInputSchema.parse(query),
        ),
    )

describe('searchPublicClubs', () => {
    it('lists only listed, active clubs, first page by default', async () => {
        const { handler, prisma } = build()
        const out = await search(handler)
        const args = prisma.workspacePublicSlug.findMany.mock.calls[0][0]
        expect(args.where).toEqual({
            workspace: { isListed: true, isActive: true },
        })
        expect(args.skip).toBe(0)
        expect(args.take).toBe(20)
        expect(prisma.workspacePublicSlug.count.mock.calls[0][0]).toEqual({
            where: args.where,
        })
        expect(prisma.workspace.findMany.mock.calls[0][0].where).toMatchObject(
            { isListed: true, isActive: true },
        )
        expect(out).toEqual({
            data: [
                {
                    slug: 'akademiya-bzhzh',
                    name: 'Академия БЖЖ',
                    type: 'GRAPPLING',
                    city: 'Томск',
                    description: 'Зал у реки',
                    logoUrl: 'https://s3/logo',
                },
                {
                    slug: 'yoga-tomsk',
                    name: 'Йога',
                    type: 'YOGA',
                    city: null,
                    description: null,
                    logoUrl: null,
                },
            ],
            total: 42,
            curPage: 1,
            perPage: 20,
            cities: ['Москва', 'Томск'],
        })
    })

    it('filters by text, city and type and pages', async () => {
        const { handler, prisma } = build()
        await search(handler, {
            q: ' акад ',
            city: 'Томск',
            type: 'GRAPPLING',
            curPage: '3',
            perPage: '10',
        })
        const args = prisma.workspacePublicSlug.findMany.mock.calls[0][0]
        expect(args.where.workspace).toEqual({
            isListed: true,
            isActive: true,
            type: 'GRAPPLING',
            city: { equals: 'Томск', mode: 'insensitive' },
            OR: [
                { name: { contains: 'акад', mode: 'insensitive' } },
                { city: { contains: 'акад', mode: 'insensitive' } },
            ],
        })
        expect(args.skip).toBe(20)
        expect(args.take).toBe(10)
    })

    it('ignores blank filters', async () => {
        const { handler, prisma } = build()
        await search(handler, { q: '   ', city: '' })
        expect(
            prisma.workspacePublicSlug.findMany.mock.calls[0][0].where.workspace,
        ).toEqual({ isListed: true, isActive: true })
    })

    it('caps the page size', () => {
        expect(
            SearchPublicClubsFeatureInputSchema.safeParse({ perPage: '500' })
                .success,
        ).toBe(false)
    })
})
