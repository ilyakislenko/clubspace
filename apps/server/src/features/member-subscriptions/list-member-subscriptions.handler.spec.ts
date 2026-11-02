import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListMemberSubscriptionsFeature } from './list-member-subscriptions.feature'
import { ListMemberSubscriptionsHandler } from './list-member-subscriptions.handler'

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Monthly' },
    directions: [],
    status: 'ACTIVE',
    startDate: new Date('2026-07-01T00:00:00Z'),
    endDate: new Date('2999-01-01T00:00:00Z'),
    amountPaid: 5000,
    currency: 'RUB',
    classesTotal: null,
    classesRemaining: null,
    source: 'MANUAL',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
})

const freezeRow = () => ({
    id: 'f1',
    subscriptionId: 's1',
    fromDate: new Date('2026-10-24T00:00:00Z'),
    untilDate: new Date('2026-10-30T00:00:00Z'),
    reason: 'Травма',
    endedEarlyAt: null,
    createdAt: new Date('2026-10-24T09:00:00Z'),
})

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteMember: jest.fn().mockResolvedValue(admin),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
    assertCanReadMember: jest.fn().mockImplementation(async () => {
        if (!admin) {
            throw new ForbiddenError({
                message: 'Участник не состоит в ваших группах',
            })
        }
    }),
})

// `subs` is the member's whole history; the current query is answered with the
// rows the DB filter (ACTIVE, not past endDate) would return, each with its
// pending request.
const build = (
    subs: Array<Record<string, unknown>>,
    freezes: unknown[] = [],
    request: { subscriptionId: string } | null = null,
) => {
    const now = Date.now()
    const current = subs
        .filter(
            (s) =>
                s.status === 'ACTIVE' &&
                (s.endDate === null || (s.endDate as Date).getTime() > now),
        )
        .map((s) => ({
            ...s,
            freezeRequests:
                request && request.subscriptionId === s.id ? [request] : [],
        }))
    const prisma = {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue({
                id: 'm1',
                user: { firstname: 'Анна', lastname: 'Ким', email: 'a@x' },
            }),
        },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }),
        },
        subscription: {
            findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
                'OR' in args.where ? current : subs,
            ),
        },
        subscriptionFreeze: { findMany: jest.fn().mockResolvedValue(freezes) },
    }
    return prisma
}

const run = (prisma: unknown, admin = true) =>
    new ListMemberSubscriptionsHandler(
        prisma as never,
        rbac(admin) as never,
    ).execute(
        new ListMemberSubscriptionsFeature('w1', 'u1', 'inv', 'admin', false),
    )

const first = (out: { abonements: Array<Record<string, unknown>> }) =>
    out.abonements[0] ?? null

describe('ListMemberSubscriptionsHandler', () => {
    it('forbids a coach of another group', async () => {
        await expect(run(build([subRow()]), false)).rejects.toThrow(
            /не состоит в ваших группах/,
        )
    })

    it('404s an unknown member', async () => {
        const prisma = build([])
        prisma.workspaceMember.findFirst.mockResolvedValue(null)
        await expect(run(prisma)).rejects.toThrow(/Участник не найден/)
    })

    it('lists every current abonement with its own request and renewal day', async () => {
        const bjj = subRow({
            id: 's1',
            classesTotal: 12,
            classesRemaining: 5,
            directions: [{ direction: { id: 'd1', name: 'БЖЖ', color: null, icon: null } }],
        })
        const muay = subRow({ id: 's2', endDate: new Date('2999-10-30T17:00:00Z') })
        const request = {
            id: 'r2',
            subscriptionId: 's2',
            userId: 'u1',
            status: 'PENDING',
            fromDate: new Date('2999-10-24T00:00:00Z'),
            days: 7,
            reason: 'Травма',
            decisionComment: null,
            decidedAt: null,
            createdAt: new Date('2026-10-24T09:00:00Z'),
        }
        const prisma = build([bjj, muay], [], request)
        const out = await run(prisma)
        expect(out.abonements.map((a) => a.id)).toEqual(['s1', 's2'])
        expect(out.abonements[0]).toMatchObject({
            directions: [{ id: 'd1', name: 'БЖЖ' }],
            freezeRequest: null,
            renewFrom: null,
        })
        expect(out.abonements[1]).toMatchObject({
            freezeRequest: { id: 'r2' },
            renewFrom: '2999-10-31',
        })
        const currentQuery = prisma.subscription.findMany.mock.calls.find(
            ([a]) => 'OR' in a.where,
        )?.[0] as { where: unknown; include: { freezeRequests: unknown } }
        expect(currentQuery.where).toMatchObject({
            workspaceMemberId: 'm1',
            NOT: { workspaceMemberId: null },
            status: 'ACTIVE',
        })
        expect(currentQuery.include.freezeRequests).toMatchObject({
            where: { status: 'PENDING' },
        })
    })

    describe('freezeRequest', () => {
        const request = {
            id: 'r1',
            subscriptionId: 's1',
            userId: 'u1',
            status: 'PENDING',
            fromDate: new Date('2999-10-24T00:00:00Z'),
            days: 7,
            reason: 'Травма',
            decisionComment: null,
            decidedAt: null,
            createdAt: new Date('2026-10-24T09:00:00Z'),
        }

        it('is the pending request of the live current abonement', async () => {
            const out = await run(build([subRow()], [], request))
            expect(first(out)?.freezeRequest).toMatchObject({
                id: 'r1',
                status: 'PENDING',
                untilDate: '2999-10-30',
            })
        })

        it('is null with no request, and an expired abonement is not listed', async () => {
            expect(first(await run(build([subRow()])))?.freezeRequest).toBeNull()
            const expired = subRow({ endDate: new Date('2020-01-01T00:00:00Z') })
            expect((await run(build([expired], [], request))).abonements).toEqual([])
        })
    })

    describe('renewFrom', () => {
        // Club midnight 31 Oct in Tomsk (UTC+7) = 17:00Z on the 30th: the
        // club-local day is the 31st whatever the server / device zone is.
        const live = (over: Record<string, unknown> = {}) =>
            subRow({ endDate: new Date('2999-10-30T17:00:00Z'), ...over })

        it('is the club-local day the live time-only abonement ends', async () => {
            const out = await run(build([live()]))
            expect(first(out)?.renewFrom).toBe('2999-10-31')
        })

        it('is null for a class pack, an expired one, no end date or no rights', async () => {
            expect(
                first(await run(build([live({ classesTotal: 8, classesRemaining: 3 })])))
                    ?.renewFrom,
            ).toBeNull()
            expect(
                (await run(build([live({ endDate: new Date('2020-01-01T00:00:00Z') })])))
                    .abonements,
            ).toEqual([])
            expect(
                first(await run(build([live({ endDate: null })])))?.renewFrom,
            ).toBeNull()
            expect((await run(build([]))).abonements).toEqual([])
            const r = rbac(false)
            r.assertCanReadMember.mockResolvedValue(undefined)
            r.canWriteMember.mockResolvedValue(false)
            const noRights = await new ListMemberSubscriptionsHandler(
                build([live()]) as never,
                r as never,
            ).execute(
                new ListMemberSubscriptionsFeature('w1', 'u1', 'inv', 'coach', false),
            )
            expect(first(noRights)?.renewFrom).toBeNull()
        })
    })

    it('gives a non-admin no manage rights over their own abonement', async () => {
        const r = rbac(false)
        r.assertCanReadMember.mockResolvedValue(undefined)
        r.canWriteMember.mockResolvedValue(true)
        const out = await new ListMemberSubscriptionsHandler(
            build([subRow()]) as never,
            r as never,
        ).execute(
            new ListMemberSubscriptionsFeature('w1', 'inv', 'inv', 'coach', false),
        )
        expect(out.permissions.canManage).toBe(false)
        expect(first(out)?.renewFrom).toBeNull()
    })

    it('titles the response with the member display name', async () => {
        const out = await run(build([subRow()]))
        expect(out.memberName).toBe('Анна Ким')
    })

    it('returns a usable abonement as current', async () => {
        const out = await run(build([subRow()]))
        expect(first(out)).toMatchObject({ id: 's1', planName: 'Monthly' })
        expect(out.history).toHaveLength(1)
    })

    it('keeps an expired abonement in history only', async () => {
        const out = await run(
            build([subRow({ endDate: new Date('2026-07-31T00:00:00Z') })]),
        )
        expect(out.abonements).toEqual([])
        expect(out.history).toHaveLength(1)
    })

    it('serializes the member freezes, newest first from the query', async () => {
        const prisma = build([subRow()], [freezeRow()])
        const out = await run(prisma)
        expect(prisma.subscriptionFreeze.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1', subscription: { workspaceMemberId: 'm1' } },
            orderBy: { fromDate: 'desc' },
        })
        expect(out.freezes).toEqual([
            {
                id: 'f1',
                subscriptionId: 's1',
                fromDate: '2026-10-24',
                untilDate: '2026-10-30',
                days: 7,
                reason: 'Травма',
                endedEarlyAt: null,
                createdAt: '2026-10-24T09:00:00.000Z',
            },
        ])
    })

    it('reports admin permissions', async () => {
        const out = await run(build([subRow()]))
        expect(out.permissions).toEqual({
            canManage: true,
            canCancel: true,
            canUnmarkPayment: true,
        })
    })

    it('lets a coach of the member manage but not cancel', async () => {
        const r = rbac(false)
        r.assertCanReadMember.mockResolvedValue(undefined)
        r.canWriteMember.mockResolvedValue(true)
        const out = await new ListMemberSubscriptionsHandler(
            build([subRow()]) as never,
            r as never,
        ).execute(
            new ListMemberSubscriptionsFeature('w1', 'u1', 'inv', 'coach', false),
        )
        expect(r.canWriteMember).toHaveBeenCalledWith(
            { scope: 'coach_own_only' },
            'u1',
        )
        expect(out.permissions).toEqual({
            canManage: true,
            canCancel: false,
            canUnmarkPayment: false,
        })
    })

    it('gives a read-all coach outside the member groups no write rights', async () => {
        const r = rbac(false)
        r.assertCanReadMember.mockResolvedValue(undefined)
        r.canWriteMember.mockResolvedValue(false)
        const out = await new ListMemberSubscriptionsHandler(
            build([subRow()]) as never,
            r as never,
        ).execute(
            new ListMemberSubscriptionsFeature('w1', 'u1', 'inv', 'coach', false),
        )
        expect(out.permissions).toEqual({
            canManage: false,
            canCancel: false,
            canUnmarkPayment: false,
        })
    })
})
