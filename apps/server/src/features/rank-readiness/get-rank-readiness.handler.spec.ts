import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere } from '../../shared/services/rbac.service'
import {
    GetRankReadinessFeature,
    GetRankReadinessInputSchema,
    READINESS_MAX_PER_PAGE,
} from './get-rank-readiness.feature'
import { GetRankReadinessHandler } from './get-rank-readiness.handler'

const OWNER = 'owner1'
const DAY = 86400000
const ago = (days: number) => new Date(Date.now() - days * DAY)

const LADDER = {
    id: 'l1',
    name: 'Взрослые',
    levels: [
        { id: 'white', name: 'Белый', color: null, order: 0, isActive: true, minVisits: null, minWeeks: null },
        { id: 'blue', name: 'Синий', color: '#00f', order: 1, isActive: true, minVisits: 3, minWeeks: null },
    ],
}

const user = (id: string, firstname: string | null = id) => ({
    id,
    firstname,
    lastname: null,
    email: `${id}@x.io`,
})

const make = (
    o: {
        scope?: string
        ladders?: unknown[]
        members?: string[]
        promotions?: object[]
        groupMembers?: string[]
        pending?: object[]
        group?: object | null
        visits?: Record<string, number>
    } = {},
) => {
    const scope = o.scope ?? 'admin'
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({
            scope,
            userId: 'me',
            workspaceId: 'w1',
            workspaceOwnerId: OWNER,
        }),
        canSeeAllGroups: jest.fn().mockReturnValue(scope !== 'coach_own_only'),
    }
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
        },
        rankLadder: { findMany: jest.fn().mockResolvedValue(o.ladders ?? [LADDER]) },
        group: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.group === undefined ? { id: 'g1' } : o.group),
        },
        workspaceMember: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.members ?? ['a']).map((id) => ({ user: user(id) }))),
        },
        user: { findUnique: jest.fn().mockResolvedValue(user(OWNER)) },
        groupMember: {
            findMany: jest
                .fn()
                .mockResolvedValue((o.groupMembers ?? []).map((userId) => ({ userId }))),
        },
        rankPromotion: { findMany: jest.fn().mockResolvedValue(o.promotions ?? []) },
        attendanceRecord: {
            groupBy: jest.fn().mockResolvedValue(
                Object.entries(o.visits ?? {}).map(([userId, n]) => ({
                    userId,
                    _count: { _all: n },
                })),
            ),
        },
        rankGradingCandidate: { findMany: jest.fn().mockResolvedValue(o.pending ?? []) },
    }
    const handler = new GetRankReadinessHandler(prisma as never, rbac as never)
    const run = (payload = {}) =>
        handler.execute(new GetRankReadinessFeature(payload, 'w1', 'me', 'coach', false))
    return { prisma, rbac, run }
}

const promo = (userId: string, levelId: string, days: number, stripes = 0) => ({
    userId,
    levelId,
    stripes,
    awardedAt: ago(days),
})

describe('getRankReadiness', () => {
    it('propagates a resolveCoachScope refusal', async () => {
        const { prisma, rbac, run } = make()
        rbac.resolveCoachScope.mockRejectedValue(new ForbiddenError({ message: 'no' }))
        await expect(run()).rejects.toThrow('no')
        expect(prisma.rankLadder.findMany).not.toHaveBeenCalled()
    })

    it('404s an unknown ladder', async () => {
        await expect(make().run({ ladderId: 'zzz' })).rejects.toThrow(/Лестница не найдена/)
    })

    it('returns an empty payload when the club has no ladders', async () => {
        const out = await make({ ladders: [] }).run()
        expect(out).toEqual({
            ladders: [],
            ladderId: null,
            data: [],
            total: 0,
            curPage: 1,
            perPage: 50,
            summary: { all: 0, ready: 0, readyUnlisted: 0 },
        })
    })

    it('404s an unknown group', async () => {
        await expect(make({ group: null }).run({ groupId: 'g9' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('flags a member who meets the rule and excludes unranked and top', async () => {
        const { run } = make({
            members: ['a', 'b', 'c'],
            promotions: [promo('a', 'white', 70), promo('c', 'blue', 5)],
            visits: { a: 5 },
        })
        const out = await run()
        expect(out.ladderId).toBe('l1')
        expect(out.data.map((e) => e.userId)).toEqual(['a'])
        expect(out.data[0]).toMatchObject({
            ready: true,
            visitsSince: 5,
            remainingText: null,
            nextLevel: { id: 'blue', name: 'Синий' },
            current: { levelId: 'white', levelName: 'Белый' },
            rule: { minVisits: 3, minWeeks: null },
            pendingGrading: null,
        })
    })

    it('measures visits from the level start, not the last stripe', async () => {
        const { prisma, run } = make({
            promotions: [promo('a', 'white', 10, 2), promo('a', 'white', 100, 0)],
        })
        const out = await run()
        const since = prisma.attendanceRecord.groupBy.mock.calls[0][0].where.OR[0]
            .markedAt.gte as Date
        expect(Math.round((Date.now() - since.getTime()) / DAY)).toBe(100)
        expect(out.data[0].current.stripes).toBe(2)
    })

    it('includes the owner, who has no member row', async () => {
        const { run } = make({
            members: [],
            promotions: [promo(OWNER, 'white', 10)],
        })
        const out = await run()
        expect(out.data).toHaveLength(1)
        expect(out.data[0]).toMatchObject({ userId: OWNER, isOwner: true })
    })

    it('shows the next pending grading for the ladder', async () => {
        const { prisma, run } = make({
            promotions: [promo('a', 'white', 10)],
            pending: [
                { userId: 'a', grading: { id: 'gr1', date: new Date('2026-11-15T00:00:00Z') } },
                { userId: 'a', grading: { id: 'gr2', date: new Date('2026-12-15T00:00:00Z') } },
            ],
        })
        const out = await run()
        expect(out.data[0].pendingGrading).toEqual({ id: 'gr1', date: '2026-11-15' })
        const where = prisma.rankGradingCandidate.findMany.mock.calls[0][0].where
        expect(where).toMatchObject({ result: 'PENDING', grading: { ladderId: 'l1' } })
    })

    it('limits a coach_own_only coach to the members of their own groups', async () => {
        const { prisma, run } = make({
            scope: 'coach_own_only',
            members: ['a', 'b'],
            groupMembers: ['b'],
            promotions: [promo('b', 'white', 10)],
        })
        const out = await run()
        // Coached (primary or assistant) or of a direction they run: the
        // candidates of a manager's gradings train in other coaches' groups.
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({
            group: { workspaceId: 'w1', ...ownGroupsWhere('me') },
        })
        expect(prisma.rankPromotion.findMany.mock.calls[0][0].where.userId.in).toEqual(['b'])
        expect(out.data.map((e) => e.userId)).toEqual(['b'])
    })

    it('keeps the own-groups rule when a scoped coach narrows to a group', async () => {
        const { prisma, run } = make({ scope: 'coach_own_only', groupMembers: ['a'] })
        await run({ groupId: 'g1' })
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({
            group: { workspaceId: 'w1', id: 'g1', ...ownGroupsWhere('me') },
        })
    })

    it('does not touch group membership for an admin without a group filter', async () => {
        const { prisma, run } = make({ promotions: [promo('a', 'white', 10)] })
        await run()
        expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
    })

    it('narrows to a group when asked', async () => {
        const { prisma, run } = make({ members: ['a', 'b'], groupMembers: ['a'] })
        await run({ groupId: 'g1' })
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({
            group: { workspaceId: 'w1', id: 'g1' },
        })
        expect(prisma.rankPromotion.findMany.mock.calls[0][0].where.userId.in).toEqual(['a'])
    })

    it('sorts ready first, then by what is left', async () => {
        const { run } = make({
            members: ['a', 'b', 'c'],
            promotions: [promo('a', 'white', 10), promo('b', 'white', 10), promo('c', 'white', 10)],
            visits: { a: 1, b: 2, c: 3 },
        })
        const out = await run()
        expect(out.data.map((e) => e.userId)).toEqual(['c', 'b', 'a'])
    })

    describe('pages', () => {
        // r1–r4 have met the rule (r1, r2 already on a grading list), s1–s3
        // are still short of visits.
        const ladder = () =>
            make({
                members: ['s1', 'r1', 's2', 'r2', 'r3', 's3', 'r4'],
                promotions: ['s1', 'r1', 's2', 'r2', 'r3', 's3', 'r4'].map((id) =>
                    promo(id, 'white', 10),
                ),
                visits: { r1: 5, r2: 5, r3: 5, r4: 5, s1: 1, s2: 2, s3: 0 },
                pending: ['r1', 'r2'].map((userId) => ({
                    userId,
                    grading: { id: 'gr1', date: new Date('2026-12-01T00:00:00Z') },
                })),
            })

        it('pages the ready, unlisted first, with totals that ignore the page', async () => {
            const { run } = ladder()
            const first = await run({ readyOnly: true, perPage: 3 })
            expect(first.data.map((e) => e.userId)).toEqual(['r3', 'r4', 'r1'])
            const second = await run({ readyOnly: true, perPage: 3, curPage: 2 })
            expect(second.data.map((e) => e.userId)).toEqual(['r2'])
            for (const page of [first, second]) {
                expect(page.total).toBe(4)
                expect(page.summary).toEqual({ all: 7, ready: 4, readyUnlisted: 2 })
            }
        })

        it('pages everyone measured, the ready first, then the closest to their rule', async () => {
            const { run } = ladder()
            const out = await run({ perPage: 5, curPage: 2 })
            expect(out.data.map((e) => e.userId)).toEqual(['s1', 's3'])
            expect(out).toMatchObject({ total: 7, curPage: 2, perPage: 5 })
            expect(out.summary).toEqual({ all: 7, ready: 4, readyUnlisted: 2 })
        })

        it('caps an unpaged call at 50 rows while the counts stay whole', async () => {
            const ids = Array.from({ length: 60 }, (_, i) => `m${String(i).padStart(2, '0')}`)
            const { run } = make({
                members: ids,
                promotions: ids.map((id) => promo(id, 'white', 10)),
                visits: Object.fromEntries(ids.map((id) => [id, 4])),
            })
            const out = await run()
            expect(out.data).toHaveLength(50)
            expect(out.total).toBe(60)
            expect(out.summary).toEqual({ all: 60, ready: 60, readyUnlisted: 60 })
        })

        it('refuses a page larger than the maximum', () => {
            expect(
                GetRankReadinessInputSchema.safeParse({ perPage: String(READINESS_MAX_PER_PAGE + 1) })
                    .success,
            ).toBe(false)
            expect(
                GetRankReadinessInputSchema.parse({ perPage: '20', curPage: '2', readyOnly: 'false' }),
            ).toEqual({ perPage: 20, curPage: 2, readyOnly: false })
        })
    })
})
