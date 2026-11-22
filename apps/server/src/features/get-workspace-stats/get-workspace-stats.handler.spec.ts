import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
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
    it('an admin sees revenue', async () => {
        const { handler } = build()
        const out = await run(handler, 'admin')
        expect(out.revenue).not.toBeNull()
        expect(out.revenue?.revenue30d).toBe(5000)
        expect(out.today.revenue).toBe(5000)
    })

    it.each(['coach', 'head_coach'])(
        'the workspace owner sees revenue whatever their row (%s)',
        async (roleName) => {
            const { handler } = build()
            const out = await run(handler, roleName, 'owner-1')
            expect(out.revenue).not.toBeNull()
        },
    )

    // Club money is stripped on the server for everyone below club admin.
    it.each([
        ['head_coach', false],
        ['coach', false],
        ['coach', true],
    ])('a %s never receives revenue (coachSeesAllGroups=%s)', async (roleName, all) => {
        const { handler, subscriptionFindMany } = build(all)
        const out = await run(handler, roleName)
        expect(out.revenue).toBeNull()
        expect(out.today.revenue).toBeNull()
        expect(out.today.currency).toBeNull()
        expect(subscriptionFindMany).not.toHaveBeenCalled()
    })
})

describe('GetWorkspaceStatsHandler paid-only revenue', () => {
    const wheres = async () => {
        const { handler, subscriptionFindMany } = build()
        await run(handler, 'admin')
        return subscriptionFindMany.mock.calls.map(([a]) => a.where)
    }

    it('reads revenue, the previous 30 days and today from paid rows only', async () => {
        const paidWheres = (await wheres()).filter(
            (w) => w.isPaid === true && w.OR,
        )
        // One 60-day read: the 30-day slice, the 30 days before it, today.
        expect(paidWheres).toHaveLength(1)
    })

    it('asks for the receivable: unpaid, active or expired', async () => {
        expect(await wheres()).toContainEqual({
            workspaceId: 'w1',
            NOT: { workspaceMemberId: null },
            isPaid: false,
            status: { in: ['ACTIVE', 'EXPIRED'] },
        })
    })

    it('reports the receivable next to revenue: the people who owe and the amount', async () => {
        const { handler, memberCount } = build()
        memberCount.mockResolvedValue(1)
        const out = await run(handler, 'admin')
        // The fixture row answers every subscription query.
        expect(out.revenue?.awaitingPayment).toEqual({ students: 1, amount: 5000 })
    })

    it('counts paid event tickets (a master class) as sales', async () => {
        const tickets = jest.fn().mockResolvedValue([
            {
                amountPaid: 1500,
                currency: 'RUB',
                paidAt: new Date(),
                createdAt: new Date(),
                eventId: 'e1',
                event: { title: 'Мастер-класс', currency: 'RUB' },
            },
        ])
        const { handler } = build(false, { 'eventRegistration.findMany': tickets })
        const out = await run(handler, 'admin')
        expect(out.revenue?.revenue30d).toBe(6500)
        expect(out.today.revenue).toBe(6500)
        for (const [args] of tickets.mock.calls) {
            expect(args.where).toMatchObject({ workspaceId: 'w1', isPaid: true })
            expect(args.where.paidAt.gte).toBeInstanceOf(Date)
        }
    })

    it('puts a sale paid 31–60 days ago into the previous period, not into revenue30d', async () => {
        const paidAt = new Date(Date.now() - 45 * 24 * 3600 * 1000)
        const tickets = jest.fn().mockResolvedValue([
            {
                amountPaid: 1500,
                currency: 'RUB',
                paidAt,
                createdAt: paidAt,
                eventId: 'e1',
                event: { title: 'Мастер-класс', currency: 'RUB' },
            },
        ])
        const { handler } = build(false, { 'eventRegistration.findMany': tickets })
        const out = await run(handler, 'admin')
        expect(out.revenue?.revenue30d).toBe(5000)
        expect(out.revenue?.revenuePrev30d).toBe(1500)
    })
})

describe('GetWorkspaceStatsHandler renewals due', () => {
    it.each([
        ['admin', 0],
        ['head_coach', 0],
        ['coach', null],
    ])('%s reads the «Продлить» count: %s', async (roleName, expected) => {
        const { handler } = build()
        const out = await run(handler, roleName)
        expect(out.retention.renewalsDue).toBe(expected)
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
    it('counts every people figure over students: active members of the student role, never the owner', async () => {
        const { handler, memberCount } = build()
        await run(handler, 'admin')
        const student = {
            workspaceId: 'w1',
            status: 'ACTIVE',
            role: { name: 'user' },
            userId: { not: 'owner-1' },
        }
        const wheres = memberCount.mock.calls.map(([a]) => JSON.stringify(a.where))
        // students, active, with abonement, attended 7d/30d, not attended 30d,
        // new today — each starts from the student filter.
        expect(wheres.filter((w) => w.includes(JSON.stringify(student))).length).toBeGreaterThanOrEqual(7)
    })

    it('counts check-ins of students only', async () => {
        const recordCount = jest.fn().mockResolvedValue(2)
        const { handler } = build(false, { 'attendanceRecord.count': recordCount })
        const out = await run(handler, 'admin')
        expect(recordCount).toHaveBeenCalledTimes(3)
        for (const [args] of recordCount.mock.calls) {
            expect(args.where.user.workspaceMemberships.some).toMatchObject({
                role: { name: 'user' },
                userId: { not: 'owner-1' },
            })
        }
        expect(out.today.checkins).toBe(2)
        expect(out.attendance.checkins7d).toBe(2)
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
            'group.findMany': jest.fn().mockResolvedValue([{ id: 'g1' }]),
        }, [
            { groupId: 'g1', cancelled: false },
            { groupId: 'g2', cancelled: false },
        ])
        const out = await run(handler, 'coach')
        expect(out.today.sessions).toBe(1)
    })
})

describe('GetWorkspaceStatsHandler coach scope', () => {
    // What the database returns for ownGroupsWhere: a direction manager's own
    // group plus a group of their direction led by another coach.
    const scoped = () => {
        const groupFindMany = jest
            .fn()
            .mockResolvedValue([{ id: 'g-own' }, { id: 'g-direction' }])
        const groupMemberFindMany = jest
            .fn()
            .mockResolvedValue([{ userId: 's1' }, { userId: 's2' }])
        const built = build(false, {
            'group.findMany': groupFindMany,
            'groupMember.findMany': groupMemberFindMany,
        })
        return { ...built, groupFindMany, groupMemberFindMany }
    }

    it('narrows coach_own_only to ownGroupsWhere: coached or of a managed direction', async () => {
        const { handler, groupFindMany, groupMemberFindMany, memberCount, sessionCount } =
            scoped()
        await run(handler, 'coach')
        const ownOfClub = { workspaceId: 'w1', ...ownGroupsWhere('u1') }
        expect(groupFindMany).toHaveBeenCalledWith({
            where: ownOfClub,
            select: { id: true },
        })
        expect(groupMemberFindMany).toHaveBeenCalledWith({
            where: { group: ownOfClub },
            distinct: ['userId'],
            select: { userId: true },
        })
        // Students of both groups (and the coach) are counted; sessions of
        // both groups too.
        expect(memberCount.mock.calls[0][0].where.AND[1].userId).toEqual({
            in: ['u1', 's1', 's2'],
        })
        expect(sessionCount.mock.calls[0][0].where.groupId).toEqual({
            in: ['g-own', 'g-direction'],
        })
    })

    it('does not narrow a coach of a club where coaches see all groups', async () => {
        const { groupFindMany, groupMemberFindMany } = scoped()
        const { handler, memberCount } = build(true, {
            'group.findMany': groupFindMany,
            'groupMember.findMany': groupMemberFindMany,
        })
        await run(handler, 'coach')
        expect(groupFindMany).not.toHaveBeenCalled()
        expect(groupMemberFindMany).not.toHaveBeenCalled()
        expect(memberCount.mock.calls[0][0].where).not.toHaveProperty('AND')
    })
})
