import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import { userSearchWhere } from '../../domains/users/user-search'
import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { ListGroupMembersFeature } from './list-group-members.feature'
import { ListGroupMembersHandler } from './list-group-members.handler'

jest.mock('../../domains/retention/load-workspace-risk', () => ({
    loadWorkspaceRisk: jest.fn(),
}))
const loadRisk = jest.mocked(loadWorkspaceRisk)

const GROUP = '22222222-2222-4222-8222-222222222222'

const member = (id: string, firstname: string) => ({
    groupId: GROUP,
    userId: id,
    joinedAt: new Date('2026-09-01T00:00:00Z'),
    user: { id, email: null, firstname, lastname: 'П' },
})

const make = (opts: {
    scope: 'admin' | 'coach_read_all' | 'coach_own_only'
    own?: boolean
    group?: object | null
    total?: number
}) => {
    const rows = [member('u-ivan', 'Иван'), member('u-olga', 'Ольга')]
    const prisma = {
        group: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    opts.group === undefined ? { id: GROUP } : opts.group,
                ),
            count: jest.fn().mockResolvedValue(opts.own ? 1 : 0),
        },
        groupMember: {
            count: jest.fn().mockResolvedValue(opts.total ?? rows.length),
            findMany: jest.fn().mockResolvedValue(rows),
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
    const run = (
        payload: { q?: string; curPage?: number; perPage?: number } = {},
        groupId = GROUP,
    ) =>
        new ListGroupMembersHandler(prisma as never, rbac).execute(
            new ListGroupMembersFeature(
                payload,
                groupId,
                'w1',
                'me',
                'coach',
                false,
            ),
        )
    const memberArgs = () => prisma.groupMember.findMany.mock.calls[0][0]
    return { prisma, run, memberArgs }
}

describe('ListGroupMembersHandler', () => {
    it('gives admin scope a page of the roster with abonements and risk', async () => {
        const { prisma, run, memberArgs } = make({ scope: 'admin', total: 31 })
        const out = await run()
        expect(out).toMatchObject({ total: 31, curPage: 1, perPage: 50 })
        const [ivan, olga] = out.data
        expect(ivan).toMatchObject({
            userId: 'u-ivan',
            firstname: 'Иван',
            risk: null,
        })
        expect(ivan.subscriptions).toEqual([
            expect.objectContaining({
                planId: 'p1',
                planName: '12 занятий',
                startDate: null,
            }),
        ])
        expect(olga.subscriptions).toEqual([])
        expect(olga.risk).toEqual({ reason: 'absent', text: 'не была 15 дней' })
        // Only this group's students, by name, first page.
        expect(memberArgs()).toMatchObject({
            where: { groupId: GROUP },
            skip: 0,
            take: 50,
            orderBy: [
                { user: { lastname: 'asc' } },
                { user: { firstname: 'asc' } },
                { userId: 'asc' },
            ],
        })
        expect(prisma.groupMember.count.mock.calls[0][0]).toEqual({
            where: { groupId: GROUP },
        })
        // Abonements and risk for the page only.
        expect(
            prisma.subscription.findMany.mock.calls[0][0].where,
        ).toMatchObject({
            workspaceId: 'w1',
            workspaceMember: { userId: { in: ['u-ivan', 'u-olga'] } },
        })
        expect(loadRisk.mock.calls[0][1]).toMatchObject({
            userIds: ['u-ivan', 'u-olga'],
        })
        expect(prisma.group.count).not.toHaveBeenCalled()
    })

    it('pages: curPage / perPage become skip / take and are echoed', async () => {
        const { run, memberArgs } = make({ scope: 'admin', total: 120 })
        await expect(run({ curPage: 3, perPage: 20 })).resolves.toMatchObject({
            total: 120,
            curPage: 3,
            perPage: 20,
        })
        expect(memberArgs()).toMatchObject({ skip: 40, take: 20 })
    })

    it('searches every word of q in the student (and guardian), counting matches only', async () => {
        const { prisma, run, memberArgs } = make({ scope: 'admin' })
        await run({ q: 'иван петров' })
        const where = {
            groupId: GROUP,
            AND: userSearchWhere('иван петров').map((user) => ({ user })),
        }
        expect(memberArgs().where).toEqual(where)
        expect(where.AND).toHaveLength(2)
        expect(prisma.groupMember.count.mock.calls[0][0]).toEqual({ where })
    })

    it('lets a coach (or direction manager) read their own group with abonements', async () => {
        const { prisma, run } = make({ scope: 'coach_own_only', own: true })
        const out = await run()
        expect(out.data[0].subscriptions).toHaveLength(1)
        expect(prisma.group.count.mock.calls[0][0].where).toEqual({
            id: GROUP,
            workspaceId: 'w1',
            ...ownGroupsWhere('me'),
        })
    })

    it('refuses coach_own_only the roster of a group they do not run', async () => {
        const { prisma, run } = make({ scope: 'coach_own_only', own: false })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
    })

    it('shows coach_read_all another group’s roster without money and risk', async () => {
        const { prisma, run } = make({ scope: 'coach_read_all', own: false })
        const out = await run()
        expect(out.data.map((m) => [m.subscriptions, m.risk])).toEqual([
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
        await expect(run({}, 'nope')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.group.findFirst).toHaveBeenCalledTimes(1)
        expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
    })
})
