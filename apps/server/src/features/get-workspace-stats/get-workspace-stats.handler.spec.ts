import { notAwaitingFirstVisitWhere } from '../manage-announcements/renewal-segment'
import { RbacService } from '../../shared/services/rbac.service'
import { GetWorkspaceStatsFeature } from './get-workspace-stats.feature'
import { GetWorkspaceStatsHandler } from './get-workspace-stats.handler'

const SUB_ROW = {
    amountPaid: 5000,
    currency: 'RUB',
    startDate: new Date(Date.now() - 24 * 3600 * 1000),
    endDate: new Date(Date.now() + 20 * 24 * 3600 * 1000),
    createdAt: new Date(),
    planId: 'p1',
    plan: { name: 'Monthly' },
}

// Every Prisma call resolves to an empty result (count -> 0, lists -> [],
// lookups -> null) except the few the revenue + scope paths actually read.
const build = (coachSeesAllGroups = false) => {
    const subscriptionFindMany = jest.fn().mockResolvedValue([SUB_ROW])
    const memberCount = jest.fn().mockResolvedValue(0)
    const sessionCount = jest.fn().mockResolvedValue(0)
    const prisma = new Proxy(
        {},
        {
            get: (_t, model: string) => {
                if (model === '$transaction')
                    return (ops: Promise<unknown>[]) => Promise.all(ops)
                return new Proxy(
                    {},
                    {
                        get: (_m, method: string) => {
                            if (
                                model === 'workspace' &&
                                method === 'findUnique'
                            )
                                return jest.fn().mockResolvedValue({
                                    ownerId: 'owner-1',
                                    coachSeesAllGroups,
                                    timezone: 'Europe/Moscow',
                                })
                            if (
                                model === 'subscription' &&
                                method === 'findMany'
                            )
                                return subscriptionFindMany
                            if (
                                model === 'workspaceMember' &&
                                method === 'count'
                            )
                                return memberCount
                            if (
                                model === 'attendanceSession' &&
                                method === 'count'
                            )
                                return sessionCount
                            return jest
                                .fn()
                                .mockResolvedValue(
                                    method === 'count'
                                        ? 0
                                        : method === 'findUnique'
                                          ? null
                                          : [],
                                )
                        },
                    },
                )
            },
        },
    )
    const handler = new GetWorkspaceStatsHandler(
        prisma as never,
        new RbacService(prisma as never),
    )
    return { handler, subscriptionFindMany, memberCount, sessionCount }
}

const run = (
    handler: GetWorkspaceStatsHandler,
    roleName: string,
    userId = 'u1',
) =>
    handler.execute(new GetWorkspaceStatsFeature('w1', userId, roleName, false))

describe('GetWorkspaceStatsHandler revenue visibility', () => {
    it.each(['admin', 'head_coach'])('%s sees revenue', async (roleName) => {
        const { handler } = build()
        const out = await run(handler, roleName)
        expect(out.revenue).not.toBeNull()
        expect(out.revenue?.revenue30d).toBe(5000)
        expect(out.today.revenue).toBe(5000)
    })

    it('the workspace owner sees revenue', async () => {
        const { handler } = build()
        const out = await run(handler, 'coach', 'owner-1')
        expect(out.revenue).not.toBeNull()
    })

    it.each([false, true])(
        'a coach never sees revenue (coachSeesAllGroups=%s)',
        async (coachSeesAllGroups) => {
            const { handler, subscriptionFindMany } = build(coachSeesAllGroups)
            const out = await run(handler, 'coach')
            expect(out.revenue).toBeNull()
            expect(out.today.revenue).toBeNull()
            expect(out.today.currency).toBeNull()
            expect(subscriptionFindMany).not.toHaveBeenCalled()
        },
    )
})

describe('GetWorkspaceStatsHandler expiringSoon', () => {
    it('does not count a pending abonement’s provisional window', async () => {
        const { handler, memberCount } = build()
        await run(handler, 'admin')
        const where = memberCount.mock.calls
            .map(([a]) => a.where)
            .find((w) => w.accessUntil?.gte && w.accessUntil?.lt)
        expect(where.OR).toEqual(notAwaitingFirstVisitWhere.OR)
    })
})

describe('GetWorkspaceStatsHandler sessions held', () => {
    it('never counts a session that has not started yet', async () => {
        const { handler, sessionCount } = build()
        await run(handler, 'admin')
        expect(sessionCount).toHaveBeenCalledTimes(3)
        for (const [args] of sessionCount.mock.calls) {
            expect(args.where.startAt.lte).toBeInstanceOf(Date)
        }
    })
})
