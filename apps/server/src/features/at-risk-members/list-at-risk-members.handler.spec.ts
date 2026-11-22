import type { CallList, CallListEntry } from '../../domains/retention/call-list'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { ListAtRiskMembersFeature } from './list-at-risk-members.feature'
import { ListAtRiskMembersHandler } from './list-at-risk-members.handler'

const entry = (
    userId: string,
    groupIds: string[],
    over: Partial<CallListEntry> = {},
): CallListEntry => ({
    userId,
    firstname: userId,
    lastname: null,
    email: null,
    phone: null,
    guardians: [],
    groups: groupIds.map((id) => ({ id, name: `name-${id}`, gymId: null, gymName: null })),
    reason: 'absent',
    signals: ['absent'],
    factsText: 'Последний визит 4 недели назад',
    facts: {
        lastVisitAt: '2026-09-01T00:00:00.000Z',
        daysSinceLastVisit: 30,
        firstVisitAt: null,
        visitsLast14d: 0,
        recentPerWeek: 0,
        baselinePerWeek: 0,
        lapseKind: null,
        lapsedAt: null,
        planName: null,
    },
    lastContact: null,
    snoozed: false,
    score: 40,
    level: 'medium',
    monthlySpend: 3000,
    currency: 'RUB',
    ...over,
})

// The whole club as the cache hands it out.
const LIST: CallList = {
    scoredAt: '2026-11-14T03:00:00.000Z',
    entries: [
        entry('a', ['own', 'other'], { reason: 'lapsed', score: 80, level: 'high', monthlySpend: 5000 }),
        entry('b', ['other']),
        entry('c', [], { score: null, level: null, monthlySpend: null, currency: null }),
        entry('d', ['own'], { snoozed: true }),
    ],
}

const OWNER = { roleName: 'admin', userId: 'owner' }
const ADMIN = { roleName: 'admin', userId: 'adm' }
const HEAD_COACH = { roleName: 'head_coach', userId: 'hc' }
const COACH = { roleName: 'coach', userId: 'coach' }
const MEMBER = { roleName: 'user', userId: 'm' }
type Who = { roleName: string; userId: string }

// `ownGroups` = what the database returns for the caller's (filtered) groups.
const make = (p: { coachSeesAllGroups?: boolean; groups?: string[] } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                ownerId: 'owner',
                coachSeesAllGroups: p.coachSeesAllGroups ?? false,
            }),
        },
        gym: { findFirst: jest.fn().mockResolvedValue({ id: 'gym1' }) },
        direction: { findFirst: jest.fn().mockResolvedValue({ id: 'dir1' }) },
        group: {
            findFirst: jest.fn().mockResolvedValue({ id: 'own' }),
            findMany: jest
                .fn()
                .mockResolvedValue((p.groups ?? ['own']).map((id) => ({ id }))),
        },
        groupCoach: { findFirst: jest.fn().mockResolvedValue({ userId: 'coach' }) },
    }
    const callLists = { get: jest.fn().mockResolvedValue(LIST) }
    const handler = new ListAtRiskMembersHandler(
        prisma as never,
        new RbacService(prisma as never),
        callLists as never,
    )
    const run = (who: Who, payload: Record<string, unknown> = {}) =>
        handler.execute(
            new ListAtRiskMembersFeature(payload, 'w1', who.userId, who.roleName, false),
        )
    return { prisma, callLists, run }
}

describe('ListAtRiskMembersHandler', () => {
    it('refuses a plain member before reading the list', async () => {
        const { run, callLists } = make()
        await expect(run(MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
        expect(callLists.get).not.toHaveBeenCalled()
    })

    it('404s on a filter id of another club', async () => {
        const { run, prisma, callLists } = make()
        prisma.gym.findFirst.mockResolvedValueOnce(null)
        await expect(run(ADMIN, { gymId: 'x' })).rejects.toBeInstanceOf(NotFoundError)
        prisma.direction.findFirst.mockResolvedValueOnce(null)
        await expect(run(ADMIN, { directionId: 'x' })).rejects.toBeInstanceOf(NotFoundError)
        prisma.group.findFirst.mockResolvedValueOnce(null)
        await expect(run(ADMIN, { groupId: 'x' })).rejects.toBeInstanceOf(NotFoundError)
        expect(callLists.get).not.toHaveBeenCalled()
    })

    it.each([
        ['the owner', OWNER],
        ['an admin', ADMIN],
        ['a head coach', HEAD_COACH],
    ])('gives %s the whole club, group-less members included', async (_, who) => {
        const { run, prisma, callLists } = make()
        const res = await run(who)
        expect(callLists.get).toHaveBeenCalledWith('w1')
        expect(res.data.map((m) => m.userId)).toEqual(['a', 'b', 'c'])
        expect(res.data[0].groups.map((g) => g.id)).toEqual(['own', 'other'])
        expect(prisma.group.findMany).not.toHaveBeenCalled()
    })

    it.each([false, true])(
        'gives a coach only their own groups (coachSeesAllGroups=%s)',
        async (coachSeesAllGroups) => {
            const { run, prisma } = make({ coachSeesAllGroups })
            const res = await run(COACH)
            expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({
                workspaceId: 'w1',
                ...ownGroupsWhere('coach'),
            })
            expect(res.data.map((m) => m.userId)).toEqual(['a'])
            // Other coaches' groups are not shown on the row.
            expect(res.data[0].groups.map((g) => g.id)).toEqual(['own'])
            expect(res.summary).toMatchObject({ total: 1, lapsed: 1, snoozed: 1 })
        },
    )

    it('narrows sport leads by gym / direction / group / coach through the groups', async () => {
        const { run, prisma } = make({ groups: ['other'] })
        const res = await run(ADMIN, { gymId: 'gym1', directionId: 'dir1', coachId: 'coach' })
        expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            gymId: 'gym1',
            directionId: 'dir1',
            coaches: { some: { userId: 'coach' } },
        })
        expect(res.data.map((m) => m.userId)).toEqual(['a', 'b'])
        expect(res.summary.total).toBe(2)
    })

    it('counts the summary over the scope, not the chip or the page', async () => {
        const { run } = make()
        const res = await run(OWNER, { reason: 'absent', perPage: 1 })
        expect(res.data.map((m) => m.userId)).toEqual(['b'])
        expect(res.total).toBe(2)
        expect(res.summary).toEqual({
            total: 3,
            lapsed: 1,
            newcomer: 0,
            absent: 2,
            declining: 0,
            high: 1,
            snoozed: 1,
            // a + b; c has no snapshot, d is snoozed.
            moneyAtStake: 8000,
            currency: 'RUB',
        })
        expect(res.scoredAt).toBe(LIST.scoredAt)
    })

    it('lists the contacted ones only with snoozed=true', async () => {
        const { run } = make()
        const res = await run(OWNER, { snoozed: true })
        expect(res.data.map((m) => [m.userId, m.snoozed])).toEqual([['d', true]])
        expect(res.total).toBe(1)
    })

    it('pages through the rows', async () => {
        const { run } = make()
        const second = await run(OWNER, { curPage: 2, perPage: 2 })
        expect(second).toMatchObject({ curPage: 2, perPage: 2, total: 3 })
        expect(second.data.map((m) => m.userId)).toEqual(['c'])
        const past = await run(OWNER, { curPage: 5, perPage: 2 })
        expect(past.data).toEqual([])
    })

    it('keeps the score join and leaves members without a snapshot unscored', async () => {
        const { run } = make()
        const { data } = await run(OWNER)
        expect(data[0]).toMatchObject({ score: 80, level: 'high' })
        expect(data[2]).toMatchObject({ score: null, level: null })
    })

    it('sends the money to the owner and admins only', async () => {
        for (const who of [OWNER, ADMIN]) {
            const res = await make().run(who)
            expect(res.data[0].monthlySpend).toBe(5000)
            expect(res.summary.moneyAtStake).toBe(8000)
        }
        for (const who of [HEAD_COACH, COACH]) {
            const res = await make().run(who)
            expect(res.data[0].monthlySpend).toBeNull()
            expect(res.summary.moneyAtStake).toBeNull()
        }
    })
})
