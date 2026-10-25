// Authorization is covered by the assert-admin-scope tests; stub it so these
// specs focus on the query and the mapping.
jest.mock('../../shared/access/assert-admin-scope', () => ({
    assertWorkspaceAdmin: jest.fn().mockResolvedValue(undefined),
}))

import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { awaitingPaymentWhere } from '../get-workspace-stats/revenue'
import { ListAwaitingPaymentFeature } from './list-awaiting-payment.feature'
import { ListAwaitingPaymentHandler } from './list-awaiting-payment.handler'

const row = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    amountPaid: 5000,
    currency: 'RUB',
    startDate: new Date('2026-10-22T00:00:00Z'),
    createdAt: new Date('2026-10-21T10:00:00Z'),
    plan: { name: '12 занятий' },
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
    roleName: string | null = 'admin',
    total = rows.length,
) => {
    const prisma = {
        subscription: {
            findMany: jest.fn().mockResolvedValue(rows),
            count: jest.fn().mockResolvedValue(total),
        },
    }
    const handler = new ListAwaitingPaymentHandler(prisma as never, {} as never)
    return {
        prisma,
        result: handler.execute(
            new ListAwaitingPaymentFeature('w1', 'inv', roleName, false),
        ),
    }
}

describe('listAwaitingPayment', () => {
    it('refuses a non-admin (coach) before touching the table', async () => {
        ;(assertWorkspaceAdmin as jest.Mock).mockRejectedValueOnce(
            new ForbiddenError({ message: 'nope' }),
        )
        const { prisma, result } = run([], 'coach')
        await expect(result).rejects.toThrow(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('asks only for unpaid, live-or-expired rows of this club, oldest start first', async () => {
        const { prisma, result } = run([])
        await result
        const args = prisma.subscription.findMany.mock.calls[0][0]
        expect(args.where).toEqual(awaitingPaymentWhere('w1'))
        expect(args.where).toEqual({
            workspaceId: 'w1',
            isPaid: false,
            status: { in: ['ACTIVE', 'EXPIRED'] },
        })
        expect(prisma.subscription.count).toHaveBeenCalledWith({
            where: args.where,
        })
        expect(args.orderBy).toEqual([
            { startDate: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
        ])
        expect(args.take).toBe(200)
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
        expect(await result).toEqual({
            total: 2,
            data: [
                {
                    subscriptionId: 's1',
                    userId: 'u1',
                    memberName: 'Иван Петров',
                    memberPhone: '+79528849420',
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
                    planName: '12 занятий',
                    amount: 5000,
                    currency: 'RUB',
                    startDate: null,
                    createdAt: '2026-10-21T10:00:00.000Z',
                },
            ],
        })
    })

    it('reports the full count when the list is capped', async () => {
        const { result } = run([row()], 'admin', 250)
        const out = await result
        expect(out.data).toHaveLength(1)
        expect(out.total).toBe(250)
    })

    it('drops a row whose member is gone', async () => {
        const { result } = run([row({ workspaceMember: null })])
        expect((await result).data).toEqual([])
    })
})
