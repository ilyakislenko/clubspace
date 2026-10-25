import { notAwaitingFirstVisitWhere } from '../manage-announcements/renewal-segment'
import { RbacService } from '../../shared/services/rbac.service'
import { GetWorkspaceStatsFeature } from './get-workspace-stats.feature'
import { GetWorkspaceStatsHandler } from './get-workspace-stats.handler'

const SUB_ROW = {
    amountPaid: 5000,
    currency: 'RUB',
    startDate: new Date(Date.now() - 24 * 3600 * 1000),
    endDate: new Date(Date.now() + 20 * 24 * 3600 * 1000),
    isPaid: true,
    paidAt: new Date(),
    createdAt: new Date(),
    planId: 'p1',
    plan: { name: 'Monthly' },
}

// Every Prisma call resolves to an empty result (count -> 0, lists -> [],
// lookups -> null) except the few the revenue + scope paths actually read.
type Overrides = Record<string, jest.Mock>

const build = (
    coachSeesAllGroups = false,
    overrides: Overrides = {},
    todaySessions: Array<{ groupId: string; cancelled: boolean }> = [],
) => {
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
                            if (overrides[`${model}.${method}`])
                                return overrides[`${model}.${method}`]
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
    const schedule = {
        execute: jest.fn().mockResolvedValue({
            timezone: 'Europe/Moscow',
            sessions: todaySessions,
            events: [],
        }),
    }
    const handler = new GetWorkspaceStatsHandler(
        prisma as never,
        new RbacService(prisma as never),
        schedule as never,
    )
    return { handler, subscriptionFindMany, memberCount, sessionCount, schedule }
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

describe('GetWorkspaceStatsHandler paid-only revenue', () => {
    const wheres = async () => {
        const { handler, subscriptionFindMany } = build()
        await run(handler, 'admin')
        return subscriptionFindMany.mock.calls.map(([a]) => a.where)
    }

    it('reads revenue, the trend and today from paid rows only', async () => {
        const paidWheres = (await wheres()).filter(
            (w) => w.isPaid === true && w.OR,
        )
        // 6-month trend/30d slice + today's glance.
        expect(paidWheres).toHaveLength(2)
    })

    it('asks for the receivable: unpaid, active or expired', async () => {
        expect(await wheres()).toContainEqual({
            workspaceId: 'w1',
            isPaid: false,
            status: { in: ['ACTIVE', 'EXPIRED'] },
        })
    })

    it('reports the receivable next to revenue', async () => {
        const { handler } = build()
        const out = await run(handler, 'admin')
        // The fixture row answers every subscription query.
        expect(out.revenue?.awaitingPayment).toEqual({ count: 1, amount: 5000 })
    })
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

describe('GetWorkspaceStatsHandler student counters', () => {
    const students = [{ userId: 's1' }, { userId: 's2' }, { userId: 's3' }]
    const recordRows = (since7: unknown[], since30: unknown[]) =>
        jest.fn().mockImplementation((args: {
            distinct?: string[]
            where: { markedAt: { gte: Date } }
        }) => {
            if (!args.distinct) return Promise.resolve([])
            const ageMs = Date.now() - args.where.markedAt.gte.getTime()
            return Promise.resolve(ageMs < 8 * 24 * 3600 * 1000 ? since7 : since30)
        })

    it('counts active members by attendance check-ins, not video views', async () => {
        const { handler } = build(false, {
            'workspaceMember.findMany': jest.fn().mockResolvedValue(students),
            // s1 came this week, s2 only this month, 'coach-1' is staff.
            'attendanceRecord.findMany': recordRows(
                [{ userId: 's1' }, { userId: 'coach-1' }],
                [{ userId: 's1' }, { userId: 's2' }, { userId: 'coach-1' }],
            ),
            'videoWatched.findMany': jest
                .fn()
                .mockResolvedValue([{ userId: 's3' }]),
        })
        const out = await run(handler, 'admin')
        expect(out.activity.activeMembers7d).toBe(1)
        expect(out.activity.activeMembers30d).toBe(2)
        expect(out.activity.videoViewers7d).toBe(1)
        expect(out.activity.videoViewers30d).toBe(1)
        // s3 never checked in this month.
        expect(out.retention.inactiveMembers30d).toBe(1)
    })

    it('keeps the owner and coaching roles out of the student queries', async () => {
        const memberFindMany = jest.fn().mockResolvedValue(students)
        const memberCount = jest.fn().mockResolvedValue(3)
        const { handler } = build(false, {
            'workspaceMember.findMany': memberFindMany,
            'workspaceMember.count': memberCount,
        })
        await run(handler, 'admin')
        const where = memberCount.mock.calls[0][0].where
        expect(where.NOT).toEqual(
            expect.arrayContaining([
                { role: { name: { in: ['admin', 'head_coach', 'coach'] } } },
                { userId: 'owner-1' },
            ]),
        )
        expect(memberFindMany.mock.calls[0][0].where.NOT).toEqual(where.NOT)
    })
})

describe('GetWorkspaceStatsHandler attendance cards count students only', () => {
    it('leaves staff out of unique attendees and today’s check-ins', async () => {
        const recordCount = jest.fn().mockResolvedValue(2)
        const { handler } = build(false, {
            'workspaceMember.findMany': jest
                .fn()
                .mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]),
            'attendanceRecord.findMany': jest
                .fn()
                .mockResolvedValue([
                    { userId: 's1', markedAt: new Date() },
                    { userId: 's2', markedAt: new Date() },
                    { userId: 'coach-1', markedAt: new Date() },
                ]),
            'attendanceRecord.count': recordCount,
        })
        const out = await run(handler, 'admin')
        expect(out.attendance.distinctAttendees30d).toBe(2)
        const todayCall = recordCount.mock.calls
            .map(([a]) => a.where)
            .find((w) => w.userId?.in)
        expect(todayCall.userId.in).toEqual(['s1', 's2'])
        expect(out.today.checkins).toBe(2)
    })
})

describe('GetWorkspaceStatsHandler classes today', () => {
    it('counts timetable classes that are not cancelled', async () => {
        const { handler, schedule } = build(false, {}, [
            { groupId: 'g1', cancelled: false },
            { groupId: 'g2', cancelled: false },
            { groupId: 'g2', cancelled: true },
        ])
        const out = await run(handler, 'admin')
        expect(out.today.sessions).toBe(2)
        const feature = schedule.execute.mock.calls[0][0]
        expect(feature.payload.from).toBe(feature.payload.to)
        expect(feature.workspaceId).toBe('w1')
    })

    it('adds the personal sessions already held today, never future ones', async () => {
        const { handler, sessionCount } = build(false, {}, [
            { groupId: 'g1', cancelled: false },
        ])
        sessionCount.mockResolvedValue(2)
        const out = await run(handler, 'admin')
        // The 7d / 30d counters read the same mock; only «today» is asserted.
        expect(out.today.sessions).toBe(3)
        const personal = sessionCount.mock.calls
            .map(([a]) => a.where)
            .find((w) => w.isPersonal)
        expect(personal.startAt.lte).toBeInstanceOf(Date)
    })

    it('shows a scoped coach only their own groups', async () => {
        const { handler } = build(false, {
            'group.findMany': jest
                .fn()
                .mockResolvedValue([{ id: 'g1', members: [] }]),
        }, [
            { groupId: 'g1', cancelled: false },
            { groupId: 'g2', cancelled: false },
        ])
        const out = await run(handler, 'coach')
        expect(out.today.sessions).toBe(1)
    })
})
