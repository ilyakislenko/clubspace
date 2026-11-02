import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { GetGroupFeature } from './get-group.feature'
import { GetGroupHandler } from './get-group.handler'

jest.mock('../../domains/retention/load-workspace-risk', () => ({
    loadWorkspaceRisk: jest.fn(),
}))
const loadRisk = jest.mocked(loadWorkspaceRisk)

const GROUP = '22222222-2222-4222-8222-222222222222'
const coachUser = { id: 'c1', email: 'c@x', firstname: 'Роман', lastname: 'С' }

const groupRow = {
    id: GROUP,
    name: 'БЖЖ взрослые',
    gym: { id: 'g1', name: 'Зал 1', address: 'ул. 1' },
    direction: null,
    coach: coachUser,
    bookingMode: 'FIXED',
    capacity: null,
    bookingWindowDays: null,
    bookingCancelHours: null,
    coaches: [{ role: 'primary', user: coachUser }],
    members: [
        {
            joinedAt: new Date('2026-09-01T00:00:00Z'),
            user: { id: 'u-ivan', email: null, firstname: 'Иван', lastname: 'П' },
        },
        {
            joinedAt: new Date('2026-09-02T00:00:00Z'),
            user: { id: 'u-olga', email: null, firstname: 'Ольга', lastname: 'К' },
        },
    ],
    slots: [
        {
            id: 's1',
            dayOfWeek: 2,
            startTime: '19:00',
            durationMin: 90,
            effectiveFrom: null,
            effectiveUntil: null,
            capacity: null,
        },
    ],
    exceptions: [],
    _count: { members: 2 },
    createdAt: new Date('2026-08-01T00:00:00Z'),
}

const make = (opts: {
    scope: 'admin' | 'coach_read_all' | 'coach_own_only'
    own?: boolean
    group?: object | null
}) => {
    const prisma = {
        group: {
            findFirst: jest.fn().mockResolvedValue(
                opts.group === undefined ? groupRow : opts.group,
            ),
            count: jest.fn().mockResolvedValue(opts.own ? 1 : 0),
        },
        subscription: {
            findMany: jest.fn().mockResolvedValue([
                {
                    id: 'sub1',
                    planId: 'p1',
                    plan: { name: '12 занятий' },
                    startDate: null,
                    endDate: null,
                    durationDays: 30,
                    createdAt: new Date('2026-10-30T00:00:00Z'),
                    classesTotal: 12,
                    classesRemaining: 12,
                    isPaid: true,
                    workspaceMember: { userId: 'u-ivan' },
                },
            ]),
        },
    }
    loadRisk.mockReset().mockResolvedValue([
        {
            userId: 'u-olga',
            risk: { reason: 'absent' },
            factsText: 'не была 15 дней',
        } as never,
    ])
    const rbac = new RbacService(prisma as never)
    jest.spyOn(rbac, 'resolveCoachScope').mockImplementation(async (p) => ({
        scope: opts.scope,
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: 'owner',
    }))
    const run = (groupId = GROUP) =>
        new GetGroupHandler(prisma as never, rbac).execute(
            new GetGroupFeature(groupId, 'w1', 'me', 'coach', false),
        )
    return { prisma, run }
}

describe('GetGroupHandler', () => {
    it('gives admin scope the group with abonements and risk of the roster', async () => {
        const { prisma, run } = make({ scope: 'admin' })
        const out = await run()
        expect(out).toMatchObject({ id: GROUP, name: 'БЖЖ взрослые', canEdit: true, memberCount: 2 })
        expect(out.slots).toEqual([expect.objectContaining({ dayOfWeek: 2, startTime: '19:00' })])
        const [ivan, olga] = out.members
        expect(ivan.subscriptions).toEqual([
            expect.objectContaining({ planId: 'p1', planName: '12 занятий', startDate: null }),
        ])
        expect(ivan.risk).toBeNull()
        expect(olga.subscriptions).toEqual([])
        expect(olga.risk).toEqual({ reason: 'absent', text: 'не была 15 дней' })
        // No own-group probe for admin scope; abonements are current ones of
        // this group's members.
        expect(prisma.group.count).not.toHaveBeenCalled()
        const where = prisma.subscription.findMany.mock.calls[0][0].where
        expect(where).toMatchObject({
            workspaceId: 'w1',
            status: 'ACTIVE',
            workspaceMember: { userId: { in: ['u-ivan', 'u-olga'] } },
        })
        expect(loadRisk.mock.calls[0][1]).toMatchObject({ userIds: ['u-ivan', 'u-olga'] })
    })

    it('lets a coach (or direction manager) open their own group, editable', async () => {
        const { prisma, run } = make({ scope: 'coach_own_only', own: true })
        await expect(run()).resolves.toMatchObject({ canEdit: true })
        expect(prisma.group.count.mock.calls[0][0].where).toEqual({
            id: GROUP,
            workspaceId: 'w1',
            ...ownGroupsWhere('me'),
        })
    })

    it('refuses coach_own_only a group they do not run', async () => {
        const { prisma, run } = make({ scope: 'coach_own_only', own: false })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('shows coach_read_all another group read-only, without money and risk', async () => {
        const { prisma, run } = make({ scope: 'coach_read_all', own: false })
        const out = await run()
        expect(out.canEdit).toBe(false)
        expect(out.members.map((m) => [m.subscriptions, m.risk])).toEqual([
            [[], null],
            [[], null],
        ])
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
        expect(loadRisk).not.toHaveBeenCalled()
    })

    it('is a 404 for a group of another club or a malformed id', async () => {
        const { prisma, run } = make({ scope: 'admin', group: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.group.findFirst.mock.calls[0][0].where).toEqual({
            id: GROUP,
            workspaceId: 'w1',
        })
        await expect(run('nope')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.group.findFirst).toHaveBeenCalledTimes(1)
    })

    it('propagates a refusal from resolveCoachScope', async () => {
        const { prisma } = make({ scope: 'admin' })
        const rbacError = new ForbiddenError({ message: 'no' })
        jest.spyOn(RbacService.prototype, 'resolveCoachScope').mockRejectedValueOnce(rbacError)
        const handler = new GetGroupHandler(prisma as never, new RbacService(prisma as never))
        await expect(
            handler.execute(new GetGroupFeature(GROUP, 'w1', 'me', 'user', false)),
        ).rejects.toBe(rbacError)
        expect(prisma.group.findFirst).not.toHaveBeenCalled()
    })
})
