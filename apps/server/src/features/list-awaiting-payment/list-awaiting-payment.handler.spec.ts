// Authorization is covered by the assert-admin-scope tests and the filter ids
// by analytics-scope's; stub both so these specs focus on the query, the
// paging and the mapping.
jest.mock('../../shared/access/assert-admin-scope', () => ({
    assertSportLead: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../domains/analytics/analytics-scope', () => ({
    ...jest.requireActual('../../domains/analytics/analytics-scope'),
    resolveAnalyticsScope: jest.fn(),
}))

import { awaitingPaymentWhere } from '../../domains/subscriptions/renewal-rules'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { resolveAnalyticsScope } from '../../domains/analytics/analytics-scope'
import {
    ListAwaitingPaymentFeature,
    type ListAwaitingPaymentInput,
} from './list-awaiting-payment.feature'
import { ListAwaitingPaymentHandler } from './list-awaiting-payment.handler'

beforeEach(() => {
    ;(resolveAnalyticsScope as jest.Mock).mockResolvedValue({
        scope: { groupIds: null, includeGroupless: true },
    })
})

const row = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    amountPaid: 5000,
    currency: 'RUB',
    startDate: new Date('2026-10-22T00:00:00Z'),
    createdAt: new Date('2026-10-21T10:00:00Z'),
    plan: { id: 'p1', name: '12 занятий' },
    workspaceMember: {
        userId: 'u1',
        user: {
            firstname: 'Иван',
            lastname: 'Петров',
            email: 'ivan@x.ru',
            phone: '+79528849420',
        },
    },
    ...over,
})

const run = (
    rows: unknown[],
    o: {
        roleName?: string
        total?: number
        members?: number
        payload?: ListAwaitingPaymentInput
    } = {},
) => {
    const prisma = {
        subscription: {
            findMany: jest.fn().mockResolvedValue(rows),
            count: jest.fn().mockResolvedValue(o.total ?? rows.length),
        },
        workspaceMember: {
            count: jest.fn().mockResolvedValue(o.members ?? rows.length),
        },
    }
    const handler = new ListAwaitingPaymentHandler(prisma as never, {} as never)
    return {
        prisma,
        result: handler.execute(
            new ListAwaitingPaymentFeature(
                o.payload ?? {},
                'w1',
                'inv',
                o.roleName ?? 'admin',
                false,
            ),
        ),
    }
}

describe('listAwaitingPayment', () => {
    it('refuses a non-admin (coach) before touching the table', async () => {
        ;(assertSportLead as jest.Mock).mockRejectedValueOnce(
            new ForbiddenError({ message: 'nope' }),
        )
        const { prisma, result } = run([], { roleName: 'coach' })
        await expect(result).rejects.toThrow(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('asks only for unpaid, live-or-expired rows of this club, oldest start first, one page', async () => {
        const { prisma, result } = run([], { payload: { curPage: 3, perPage: 20 } })
        expect(await result).toMatchObject({ curPage: 3, perPage: 20 })
        const args = prisma.subscription.findMany.mock.calls[0][0]
        expect(args.where).toEqual(awaitingPaymentWhere('w1'))
        expect(args.where).toEqual({
            workspaceId: 'w1',
            NOT: { workspaceMemberId: null },
            isPaid: false,
            status: { in: ['ACTIVE', 'EXPIRED'] },
        })
        expect(prisma.subscription.count).toHaveBeenCalledWith({
            where: args.where,
        })
        expect(args.orderBy).toEqual([
            { startDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
            { id: 'asc' },
        ])
        expect(args.skip).toBe(40)
        expect(args.take).toBe(20)
    })

    it('counts the people who owe (the members filter «Должники»)', async () => {
        const { prisma, result } = run([row()], { total: 3, members: 2 })
        expect(await result).toMatchObject({ total: 3, members: 2 })
        expect(prisma.workspaceMember.count).toHaveBeenCalledWith({
            where: {
                AND: [
                    { workspaceId: 'w1' },
                    {
                        subscriptions: {
                            some: {
                                isPaid: false,
                                status: { in: ['ACTIVE', 'EXPIRED'] },
                            },
                        },
                    },
                    {},
                ],
            },
        })
    })

    it('narrows a filtered list to the members of the matching groups', async () => {
        ;(resolveAnalyticsScope as jest.Mock).mockResolvedValueOnce({
            scope: { groupIds: new Set(['g1']), includeGroupless: false },
        })
        const { prisma, result } = run([], { payload: { groupId: 'g1' } })
        await result
        const inGroup = {
            user: { groupMemberships: { some: { groupId: { in: ['g1'] } } } },
        }
        expect(prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
            ...awaitingPaymentWhere('w1'),
            workspaceMember: inGroup,
        })
        expect(
            prisma.workspaceMember.count.mock.calls[0][0].where.AND[2],
        ).toEqual(inGroup)
    })

    it('maps rows; a not-started abonement has a null startDate', async () => {
        const { result } = run([
            row(),
            row({
                id: 's2',
                startDate: null,
                workspaceMember: {
                    userId: 'u2',
                    user: {
                        firstname: null,
                        lastname: null,
                        email: 'anon@x.ru',
                        phone: null,
                    },
                },
            }),
        ])
        expect((await result).data).toEqual([
            {
                subscriptionId: 's1',
                userId: 'u1',
                memberName: 'Иван Петров',
                memberPhone: '+79528849420',
                planId: 'p1',
                planName: '12 занятий',
                amount: 5000,
                currency: 'RUB',
                startDate: '2026-10-22T00:00:00.000Z',
                createdAt: '2026-10-21T10:00:00.000Z',
            },
            {
                subscriptionId: 's2',
                userId: 'u2',
                memberName: 'anon@x.ru',
                memberPhone: null,
                planId: 'p1',
                planName: '12 занятий',
                amount: 5000,
                currency: 'RUB',
                startDate: null,
                createdAt: '2026-10-21T10:00:00.000Z',
            },
        ])
    })

    it('drops a row whose member is gone', async () => {
        const { result } = run([row({ workspaceMember: null })])
        expect((await result).data).toEqual([])
    })
})
