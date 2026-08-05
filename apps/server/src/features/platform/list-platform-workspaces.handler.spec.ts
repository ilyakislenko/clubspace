import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListPlatformWorkspacesFeature } from './list-platform-workspaces.feature'
import { ListPlatformWorkspacesHandler } from './list-platform-workspaces.handler'

const workspaceRow = (over: Record<string, unknown> = {}) => ({
    id: 'w1',
    key: 'bjj_school',
    name: 'BJJ School',
    type: 'GRAPPLING',
    isActive: true,
    timezone: 'Europe/Moscow',
    ownerId: 'u1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    _count: { members: 12 },
    ...over,
})

type BuildOpts = {
    workspaces?: ReturnType<typeof workspaceRow>[]
    owners?: { id: string; email: string }[]
    total?: number
}

const build = (opts: BuildOpts = {}) => {
    const prisma = {
        workspace: {
            findMany: jest
                .fn()
                .mockResolvedValue(opts.workspaces ?? [workspaceRow()]),
            count: jest.fn().mockResolvedValue(opts.total ?? 1),
        },
        user: {
            findMany: jest.fn().mockResolvedValue(
                opts.owners ?? [
                    {
                        id: 'u1',
                        email: 'owner@club.ru',
                        firstname: 'Иван',
                        lastname: null,
                    },
                ],
            ),
        },
    }
    const handler = new ListPlatformWorkspacesHandler(prisma as never)
    return { handler, prisma }
}

const run = (
    handler: ListPlatformWorkspacesHandler,
    payload: Record<string, unknown> = {},
    isSuperAdmin = true,
) =>
    handler.execute(
        new ListPlatformWorkspacesFeature(
            payload as never,
            'platform-admin',
            isSuperAdmin,
        ),
    )

describe('ListPlatformWorkspacesHandler', () => {
    it('refuses a caller who is not a platform admin', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, {}, false)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.workspace.findMany).not.toHaveBeenCalled()
    })

    it('lists every workspace, not just the caller’s own', async () => {
        const { handler, prisma } = build()
        await run(handler)
        // No userId/membership filter anywhere in the where-clause — that is
        // the entire difference from get-my-workspaces.
        expect(prisma.workspace.findMany.mock.calls[0][0].where).toEqual({})
    })

    it('serializes owner and member count', async () => {
        const { handler } = build()
        const result = await run(handler)
        expect(result.data[0]).toEqual({
            workspaceId: 'w1',
            key: 'bjj_school',
            name: 'BJJ School',
            type: 'GRAPPLING',
            isActive: true,
            timezone: 'Europe/Moscow',
            owner: {
                userId: 'u1',
                email: 'owner@club.ru',
                firstname: 'Иван',
                lastname: null,
            },
            memberCount: 12,
            createdAt: '2026-08-01T00:00:00.000Z',
        })
    })

    // ownerId is a plain column, not a foreign key, so a missing user row must
    // degrade to owner:null rather than throwing.
    it('tolerates a workspace whose owner row is gone', async () => {
        const { handler } = build({ owners: [] })
        const result = await run(handler)
        expect(result.data[0].owner).toBeNull()
    })

    it('defaults to 20 per page', async () => {
        const { handler, prisma } = build()
        const result = await run(handler)
        expect(prisma.workspace.findMany.mock.calls[0][0].take).toBe(20)
        expect(result.meta).toEqual({ curPage: 1, perPage: 20, total: 1 })
    })

    it('paginates', async () => {
        const { handler, prisma } = build({ total: 45 })
        const result = await run(handler, { curPage: 3, perPage: 10 })
        expect(prisma.workspace.findMany.mock.calls[0][0].skip).toBe(20)
        expect(result.meta).toEqual({ curPage: 3, perPage: 10, total: 45 })
    })

    it('searches name, key and matching owner ids', async () => {
        const { handler, prisma } = build()
        await run(handler, { search: 'gracie' })
        expect(prisma.workspace.findMany.mock.calls[0][0].where).toEqual({
            OR: [
                { name: { contains: 'gracie', mode: 'insensitive' } },
                { key: { contains: 'gracie', mode: 'insensitive' } },
                { ownerId: { in: ['u1'] } },
            ],
        })
    })

    it('drops the owner clause when no email matches', async () => {
        const { handler, prisma } = build({ owners: [] })
        await run(handler, { search: 'gracie' })
        expect(prisma.workspace.findMany.mock.calls[0][0].where.OR).toHaveLength(
            2,
        )
    })

    it('skips the owner lookup entirely when nothing was found', async () => {
        const { handler, prisma } = build({ workspaces: [], total: 0 })
        const result = await run(handler)
        expect(prisma.user.findMany).not.toHaveBeenCalled()
        expect(result.data).toEqual([])
    })
})
