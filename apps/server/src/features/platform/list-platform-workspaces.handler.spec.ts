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

const FUTURE = new Date(Date.now() + 30 * 86_400_000)
const PAST = new Date(Date.now() - 86_400_000)

const billingRow = (over: Record<string, unknown> = {}) => ({
    status: 'TRIAL',
    trialEndsAt: new Date('2026-08-15T00:00:00.000Z'),
    currentPeriodEnd: null,
    pastDueSince: null,
    notes: 'Счёт №7',
    freeUntil: null,
    discountPercent: 0,
    discountUntil: null,
    setupFeeWaived: false,
    setupFeePaidAt: null,
    ...over,
})

type BuildOpts = {
    workspaces?: ReturnType<typeof workspaceRow>[]
    owners?: { id: string; email: string }[]
    billing?: Record<string, ReturnType<typeof billingRow>>
    active?: Record<string, number>
    comps?: { workspaceId: string; module: string; mode: string; compUntil: Date }[]
}

const build = (opts: BuildOpts = {}) => {
    const rows = opts.workspaces ?? [workspaceRow()]
    const prisma = {
        workspace: {
            // The first call ranks every match; the second loads the page.
            findMany: jest.fn(
                async (args: { where: { id?: { in: string[] } } }) =>
                    args.where.id
                        ? rows.filter((r) => args.where.id!.in.includes(r.id))
                        : rows,
            ),
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
        workspaceModuleEntitlement: {
            findMany: jest.fn().mockResolvedValue(opts.comps ?? []),
        },
    }
    const billing = {
        getBillingMany: jest.fn(
            async (ids: string[]) =>
                new Map(ids.map((id) => [id, opts.billing?.[id] ?? billingRow()])),
        ),
        countActiveMembersMany: jest.fn(
            async (ws: { id: string }[]) =>
                new Map(ws.map((w) => [w.id, opts.active?.[w.id] ?? 64])),
        ),
    }
    const handler = new ListPlatformWorkspacesHandler(
        prisma as never,
        billing as never,
    )
    return { handler, prisma, billing }
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

// Three clubs: a small new trial, a big overdue one, a mid-size one on a
// discount promo.
const three = () =>
    build({
        workspaces: [
            workspaceRow({ id: 'a', name: 'Альфа', createdAt: new Date('2026-10-01') }),
            workspaceRow({ id: 'b', name: 'Бета', createdAt: new Date('2026-09-01') }),
            workspaceRow({ id: 'c', name: 'Вега', createdAt: new Date('2026-08-01') }),
        ],
        active: { a: 10, b: 150, c: 80 },
        billing: {
            a: billingRow(),
            b: billingRow({ status: 'PAST_DUE', pastDueSince: PAST }),
            c: billingRow({
                status: 'ACTIVE',
                discountPercent: 20,
                discountUntil: FUTURE,
            }),
        },
    })

const ids = (r: { data: { workspaceId: string }[] }) =>
    r.data.map((w) => w.workspaceId)

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
        expect(result.data[0]).toMatchObject({
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

    it("adds each club's status, active members, tier, billing notes and promos", async () => {
        const { handler, billing } = build({
            billing: { w1: billingRow({ freeUntil: FUTURE }) },
        })
        const result = await run(handler)
        expect(billing.getBillingMany).toHaveBeenCalledWith(['w1'])
        expect(result.data[0].billing).toMatchObject({
            status: 'TRIAL',
            trialEndsAt: '2026-08-15T00:00:00.000Z',
            activeMembers: 64,
            tier: { code: 'club', name: 'Клуб', upTo: 100 },
            suspendsAt: null,
        })
        expect(result.data[0].billingNotes).toBe('Счёт №7')
        expect(result.data[0].promos).toEqual([
            {
                kind: 'FREE_PERIOD',
                title: 'Подписка бесплатно',
                until: FUTURE.toISOString(),
            },
        ])
    })

    // ownerId is a plain column, not a foreign key, so a missing user row must
    // degrade to owner:null rather than throwing.
    it('tolerates a workspace whose owner row is gone', async () => {
        const { handler } = build({ owners: [] })
        const result = await run(handler)
        expect(result.data[0].owner).toBeNull()
    })

    it('defaults to newest first, 20 per page', async () => {
        const { handler } = three()
        const result = await run(handler)
        expect(ids(result)).toEqual(['a', 'b', 'c'])
        expect(result.meta).toEqual({ curPage: 1, perPage: 20, total: 3 })
    })

    it('paginates after ranking', async () => {
        const { handler } = three()
        const result = await run(handler, { curPage: 2, perPage: 2 })
        expect(ids(result)).toEqual(['c'])
        expect(result.meta).toEqual({ curPage: 2, perPage: 2, total: 3 })
    })

    it('sorts by active members, tier and name', async () => {
        const { handler } = three()
        expect(ids(await run(handler, { sort: 'activeMembers' }))).toEqual(['b', 'c', 'a'])
        expect(
            ids(await run(handler, { sort: 'activeMembers', order: 'asc' })),
        ).toEqual(['a', 'c', 'b'])
        // 150 → Про, 80 → Клуб, 10 → Старт.
        expect(ids(await run(handler, { sort: 'tier', order: 'asc' }))).toEqual(['a', 'c', 'b'])
        expect(ids(await run(handler, { sort: 'name' }))).toEqual(['a', 'b', 'c'])
    })

    it('filters by status, tier and a running promo', async () => {
        const { handler } = three()
        expect(ids(await run(handler, { status: 'PAST_DUE' }))).toEqual(['b'])
        expect(ids(await run(handler, { tier: 'club' }))).toEqual(['c'])
        const promo = await run(handler, { promo: true })
        expect(ids(promo)).toEqual(['c'])
        expect(promo.meta.total).toBe(1)
        expect(ids(await run(handler, { promo: false }))).toEqual(['a', 'b'])
    })

    it('an expired discount is not a running promo; a gifted module is', async () => {
        const { handler } = build({
            workspaces: [workspaceRow({ id: 'x' }), workspaceRow({ id: 'y' })],
            billing: {
                x: billingRow({ discountPercent: 30, discountUntil: PAST }),
                y: billingRow(),
            },
            comps: [{ workspaceId: 'y', module: 'VIDEO', mode: 'COMP', compUntil: FUTURE }],
        })
        const result = await run(handler, { promo: true })
        expect(ids(result)).toEqual(['y'])
        expect(result.data[0].promos[0]).toMatchObject({ kind: 'MODULE_GIFT' })
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
        const where = prisma.workspace.findMany.mock.calls[0][0].where as {
            OR: unknown[]
        }
        expect(where.OR).toHaveLength(2)
    })

    it('skips the page queries entirely when nothing was found', async () => {
        const { handler, prisma } = build({ workspaces: [] })
        const result = await run(handler)
        expect(prisma.user.findMany).not.toHaveBeenCalled()
        expect(prisma.workspace.findMany).toHaveBeenCalledTimes(1)
        expect(result.data).toEqual([])
    })
})
