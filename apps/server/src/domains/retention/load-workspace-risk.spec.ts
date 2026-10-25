import { loadWorkspaceRisk } from './load-workspace-risk'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-25T12:00:00Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY)

const member = (userId: string, over: Record<string, unknown> = {}) => ({
    userId,
    accessUntil: null,
    user: {
        firstname: userId.toUpperCase(),
        lastname: null,
        email: `${userId}@x.io`,
        phone: null,
    },
    subscription: null,
    ...over,
})

type Over = {
    workspace?: unknown
    members?: unknown[]
    bounds?: unknown[]
    window?: unknown[]
    active?: unknown
    freezes?: unknown[]
    groups?: unknown[]
    contacts?: unknown[]
}

const make = (o: Over = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue(
                o.workspace === undefined
                    ? { ownerId: 'owner', timezone: 'Asia/Tomsk' }
                    : o.workspace,
            ),
        },
        workspaceMember: { findMany: jest.fn().mockResolvedValue(o.members ?? []) },
        attendanceRecord: {
            groupBy: jest.fn().mockResolvedValue(o.bounds ?? []),
            findMany: jest.fn().mockResolvedValue(o.window ?? []),
            findFirst: jest
                .fn()
                .mockResolvedValue(o.active === undefined ? { id: 'a1' } : o.active),
        },
        subscriptionFreeze: { findMany: jest.fn().mockResolvedValue(o.freezes ?? []) },
        groupMember: { findMany: jest.fn().mockResolvedValue(o.groups ?? []) },
        memberRetentionContact: { findMany: jest.fn().mockResolvedValue(o.contacts ?? []) },
    }
    return prisma
}

const run = (prisma: unknown, userIds?: string[]) =>
    loadWorkspaceRisk(prisma as never, { workspaceId: 'w1', now: NOW, userIds })

// Absent for 20 days with 3 visits: first 100d ago, last 20d ago.
const absentBounds = (userId: string, lastDays = 20) => ({
    userId,
    _min: { markedAt: daysAgo(100) },
    _max: { markedAt: daysAgo(lastDays) },
})

describe('loadWorkspaceRisk', () => {
    it('returns nothing for an unknown workspace', async () => {
        const prisma = make({ workspace: null })
        expect(await run(prisma)).toEqual([])
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('scopes every query to the workspace and excludes the owner and staff', async () => {
        const prisma = make({ members: [member('a')] })
        await run(prisma)
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            status: 'ACTIVE',
            role: { name: 'user' },
            userId: { not: 'owner' },
            user: { deletedAt: null },
        })
        // The all-time visit bounds only scan the members in scope.
        expect(prisma.attendanceRecord.groupBy.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['a'] },
        })
        const windowWhere = prisma.attendanceRecord.findMany.mock.calls[0][0].where
        expect(windowWhere.workspaceId).toBe('w1')
        expect(windowWhere.markedAt.gte).toEqual(daysAgo(84))
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({
            group: { workspaceId: 'w1' },
            userId: { in: ['a'] },
        })
        const contactWhere = prisma.memberRetentionContact.findMany.mock.calls[0][0].where
        expect(contactWhere.workspaceId).toBe('w1')
        expect(contactWhere.createdAt.gte).toEqual(daysAgo(14))
        expect(prisma.subscriptionFreeze.findMany.mock.calls[0][0].where.workspaceId).toBe('w1')
    })

    it('passes userIds into every per-member query but not the activity probe', async () => {
        const prisma = make({ members: [member('u1')] })
        await run(prisma, ['u1'])
        const u = { userId: { in: ['u1'] } }
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where.userId).toEqual({
            not: 'owner',
            in: ['u1'],
        })
        expect(prisma.attendanceRecord.groupBy.mock.calls[0][0].where).toMatchObject(u)
        expect(prisma.attendanceRecord.findMany.mock.calls[0][0].where).toMatchObject(u)
        expect(prisma.subscriptionFreeze.findMany.mock.calls[0][0].where).toMatchObject(u)
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toMatchObject(u)
        expect(prisma.memberRetentionContact.findMany.mock.calls[0][0].where).toMatchObject(u)
        const probe = prisma.attendanceRecord.findFirst.mock.calls[0][0].where
        expect(probe.userId).toBeUndefined()
        expect(probe.markedAt.gte).toEqual(daysAgo(14))
    })

    it('drops members without risk and assembles groups for the rest', async () => {
        const prisma = make({
            members: [member('a'), member('b')],
            bounds: [
                absentBounds('a'),
                { userId: 'b', _min: { markedAt: daysAgo(100) }, _max: { markedAt: daysAgo(1) } },
            ],
            groups: [
                { userId: 'a', group: { id: 'g1', name: 'Взрослые', gymId: 'gy1', gym: { name: 'Зал 1' } } },
                { userId: 'a', group: { id: 'g2', name: 'Дети', gymId: null, gym: null } },
            ],
        })
        const res = await run(prisma)
        expect(res.map((e) => e.userId)).toEqual(['a'])
        expect(res[0].risk.reason).toBe('absent')
        expect(res[0].factsText).toBe('Последний визит 2 недели назад')
        expect(res[0].groups).toEqual([
            { id: 'g1', name: 'Взрослые', gymId: 'gy1', gymName: 'Зал 1' },
            { id: 'g2', name: 'Дети', gymId: null, gymName: null },
        ])
        expect(res[0].lastContact).toBeNull()
        expect(res[0].snoozed).toBe(false)
    })

    it('marks a member snoozed by their newest contact', async () => {
        const prisma = make({
            members: [member('a')],
            bounds: [absentBounds('a')],
            contacts: [
                {
                    id: 'c2',
                    userId: 'a',
                    createdAt: daysAgo(1),
                    note: 'позвонил',
                    reason: 'absent',
                    signals: ['absent'],
                    contactedBy: { firstname: 'Иван', lastname: 'Тренер', email: 't@x.io' },
                },
                {
                    id: 'c1',
                    userId: 'a',
                    createdAt: daysAgo(9),
                    note: null,
                    reason: null,
                    signals: [],
                    contactedBy: { firstname: null, lastname: null, email: 't@x.io' },
                },
            ],
        })
        const [e] = await run(prisma)
        expect(e.snoozed).toBe(true)
        expect(e.lastContact).toEqual({
            id: 'c2',
            at: daysAgo(1),
            byName: 'Иван Тренер',
            note: 'позвонил',
            reason: 'absent',
            signals: ['absent'],
        })
    })

    it('treats an active freeze as not at risk and a finished one as an anchor', async () => {
        const prisma = make({
            members: [member('a'), member('b')],
            bounds: [absentBounds('a', 30), absentBounds('b', 30)],
            freezes: [
                { userId: 'a', untilDate: new Date('2026-10-30T00:00:00Z'), subscription: { status: 'ACTIVE' } },
                { userId: 'b', untilDate: new Date('2026-10-20T00:00:00Z'), subscription: { status: 'ACTIVE' } },
            ],
        })
        // a is frozen; b's freeze ended on 20 Oct (anchor 21 Oct, 4 days ago): no absence yet.
        expect(await run(prisma)).toEqual([])
    })

    it('also hides a member whose freeze starts within the next 7 days', async () => {
        const prisma = make({
            members: [member('a')],
            bounds: [absentBounds('a', 30)],
            freezes: [
                { userId: 'a', untilDate: new Date('2026-11-05T00:00:00Z'), subscription: { status: 'ACTIVE' } },
            ],
        })
        expect(await run(prisma)).toEqual([])
        // 25 Oct club-local + 7 days.
        expect(
            prisma.subscriptionFreeze.findMany.mock.calls[0][0].where.fromDate.lte,
        ).toEqual(new Date('2026-11-01T00:00:00Z'))
    })

    it('ignores an active-window freeze whose abonement is no longer ACTIVE', async () => {
        const prisma = make({
            members: [member('a')],
            bounds: [absentBounds('a', 30)],
            freezes: [
                { userId: 'a', untilDate: new Date('2026-10-30T00:00:00Z'), subscription: { status: 'CANCELLED' } },
            ],
        })
        expect((await run(prisma)).map((e) => e.userId)).toEqual(['a'])
    })

    it('switches attendance signals off when nobody marked a visit in 14 days', async () => {
        const prisma = make({
            active: null,
            members: [member('a')],
            bounds: [absentBounds('a', 30)],
        })
        expect(await run(prisma)).toEqual([])
    })

    it('sorts by reason, then longest absence, then name', async () => {
        const expired = {
            status: 'EXPIRED',
            endDate: daysAgo(3),
            classesRemaining: null,
            plan: { name: 'Безлимит' },
        }
        const prisma = make({
            members: [
                member('d', { user: { firstname: 'Борис', lastname: null, email: 'd@x.io', phone: null } }),
                member('c', { user: { firstname: 'Анна', lastname: null, email: 'c@x.io', phone: null } }),
                member('b'),
                member('a', { subscription: expired }),
            ],
            bounds: [absentBounds('b', 50), absentBounds('c', 20), absentBounds('d', 20), absentBounds('a', 5)],
        })
        const res = await run(prisma)
        expect(res.map((e) => e.userId)).toEqual(['a', 'b', 'c', 'd'])
        expect(res[0].risk.reason).toBe('lapsed')
    })
})
