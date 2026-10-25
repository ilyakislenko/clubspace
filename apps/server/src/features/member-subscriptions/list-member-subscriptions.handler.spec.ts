import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListMemberSubscriptionsFeature } from './list-member-subscriptions.feature'
import { ListMemberSubscriptionsHandler } from './list-member-subscriptions.handler'

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    planId: 'p1',
    plan: { name: 'Monthly' },
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

const build = (subs: unknown[], freezes: unknown[] = []) => {
    const prisma = {
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue({
                    id: 'm1',
                    subscriptionId: 's1',
                    user: { firstname: 'Анна', lastname: 'Ким', email: 'a@x' },
                }),
        },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }),
        },
        subscription: { findMany: jest.fn().mockResolvedValue(subs) },
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

describe('ListMemberSubscriptionsHandler', () => {
    it('forbids a coach of another group', async () => {
        await expect(run(build([subRow()]), false)).rejects.toThrow(
            /не состоит в ваших группах/,
        )
    })

    describe('renewFrom', () => {
        // Club midnight 31 Oct in Tomsk (UTC+7) = 17:00Z on the 30th: the
        // club-local day is the 31st whatever the server / device zone is.
        const live = (over: Record<string, unknown> = {}) =>
            subRow({ endDate: new Date('2999-10-30T17:00:00Z'), ...over })

        it('is the club-local day the live time-only abonement ends', async () => {
            const out = await run(build([live()]))
            expect(out.renewFrom).toBe('2999-10-31')
        })

        it('is null for a class pack, an expired one, no end date or no rights', async () => {
            expect(
                (await run(build([live({ classesTotal: 8, classesRemaining: 3 })])))
                    .renewFrom,
            ).toBeNull()
            expect(
                (await run(build([live({ endDate: new Date('2020-01-01T00:00:00Z') })])))
                    .renewFrom,
            ).toBeNull()
            expect(
                (await run(build([live({ endDate: null })]))).renewFrom,
            ).toBeNull()
            expect((await run(build([]))).renewFrom).toBeNull()
            const r = rbac(false)
            r.assertCanReadMember.mockResolvedValue(undefined)
            r.canWriteMember.mockResolvedValue(false)
            const noRights = await new ListMemberSubscriptionsHandler(
                build([live()]) as never,
                r as never,
            ).execute(
                new ListMemberSubscriptionsFeature('w1', 'u1', 'inv', 'coach', false),
            )
            expect(noRights.renewFrom).toBeNull()
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
        expect(out.renewFrom).toBeNull()
    })

    it('titles the response with the member display name', async () => {
        const out = await run(build([subRow()]))
        expect(out.memberName).toBe('Анна Ким')
    })

    it('returns the usable pointer row as current', async () => {
        const out = await run(build([subRow()]))
        expect(out.current).toMatchObject({ id: 's1', planName: 'Monthly' })
        expect(out.history).toHaveLength(1)
    })

    it('returns current null when the pointed-at abonement has expired', async () => {
        const out = await run(
            build([subRow({ endDate: new Date('2026-07-31T00:00:00Z') })]),
        )
        expect(out.current).toBeNull()
        expect(out.history).toHaveLength(1)
    })

    it('serializes the member freezes, newest first from the query', async () => {
        const prisma = build([subRow()], [freezeRow()])
        const out = await run(prisma)
        expect(prisma.subscriptionFreeze.findMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
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
