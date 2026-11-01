import {
    scopeCoversDirection,
    scopeMatchesAny,
} from './current-subscriptions'
import {
    compareVisitPrecedence,
    isEligibleForVisit,
    loadVisitCandidates,
    pickVisitAbonement,
    rankVisitAbonements,
    toVisitAbonement,
    type VisitAbonementCandidate,
} from './visit-abonement'

const NOW = new Date('2026-11-10T12:00:00.000Z')
const day = (d: number) => new Date(Date.UTC(2026, 10, d))
const BJJ = 'bjj'
const MMA = 'mma'
const MT = 'muay-thai'

let seq = 0
const sub = (
    over: Partial<VisitAbonementCandidate> = {},
): VisitAbonementCandidate => ({
    id: `sub-${++seq}`,
    status: 'ACTIVE',
    startDate: day(1),
    endDate: day(30),
    createdAt: day(1),
    classesTotal: 12,
    classesRemaining: 6,
    startsOnFirstVisit: false,
    directionIds: [],
    frozen: false,
    ...over,
})

const pick = (subs: VisitAbonementCandidate[], dir: string | null) =>
    pickVisitAbonement(subs, { sessionDirectionId: dir, now: NOW })?.id ?? null
const rank = (subs: VisitAbonementCandidate[], dir: string | null) =>
    rankVisitAbonements(subs, { sessionDirectionId: dir, now: NOW }).map(
        (s) => s.id,
    )

describe('scopeCoversDirection', () => {
    it('club-wide covers every class, including one without a direction', () => {
        expect(scopeCoversDirection([], BJJ)).toBe(true)
        expect(scopeCoversDirection([], null)).toBe(true)
    })

    it('a scoped abonement covers only classes of its directions', () => {
        expect(scopeCoversDirection([BJJ, MMA], BJJ)).toBe(true)
        expect(scopeCoversDirection([BJJ, MMA], MMA)).toBe(true)
        expect(scopeCoversDirection([BJJ, MMA], MT)).toBe(false)
    })

    it('a scoped abonement never covers a class without a direction', () => {
        expect(scopeCoversDirection([BJJ], null)).toBe(false)
    })
})

describe('scopeMatchesAny', () => {
    it('club-wide matches any member, even one without directions', () => {
        expect(scopeMatchesAny([], new Set())).toBe(true)
        expect(scopeMatchesAny([], new Set([BJJ]))).toBe(true)
    })

    it('a scoped tariff matches members of one of its directions only', () => {
        expect(scopeMatchesAny([BJJ, MMA], new Set([MMA]))).toBe(true)
        expect(scopeMatchesAny([BJJ], new Set([MT]))).toBe(false)
        expect(scopeMatchesAny([BJJ], new Set())).toBe(false)
    })
})

describe('isEligibleForVisit', () => {
    const ok = (s: VisitAbonementCandidate, dir: string | null = BJJ) =>
        isEligibleForVisit(s, { sessionDirectionId: dir, now: NOW })

    it('accepts a live pack with classes left', () => {
        expect(ok(sub())).toBe(true)
    })

    it('rejects a cancelled or expired one', () => {
        expect(ok(sub({ status: 'CANCELLED' }))).toBe(false)
        expect(ok(sub({ status: 'EXPIRED' }))).toBe(false)
        expect(ok(sub({ endDate: day(9) }))).toBe(false)
        expect(ok(sub({ endDate: NOW }))).toBe(false)
    })

    it('rejects a dated abonement that starts later (a renewal not begun yet)', () => {
        expect(ok(sub({ startDate: day(11) }))).toBe(false)
    })

    it('accepts one waiting for its first visit (no dates yet)', () => {
        expect(
            ok(sub({ startDate: null, endDate: null, startsOnFirstVisit: true })),
        ).toBe(true)
    })

    it('rejects a frozen one', () => {
        expect(ok(sub({ frozen: true }))).toBe(false)
    })

    it('rejects an exhausted pack but accepts a time-based abonement', () => {
        expect(ok(sub({ classesRemaining: 0 }))).toBe(false)
        expect(ok(sub({ classesTotal: null, classesRemaining: null }))).toBe(true)
    })

    it('rejects a scope that does not cover the class', () => {
        expect(ok(sub({ directionIds: [MMA] }), BJJ)).toBe(false)
        expect(ok(sub({ directionIds: [MMA] }), null)).toBe(false)
    })
})

describe('visit precedence', () => {
    it('«БЖЖ + ММА» is drawn by BJJ and MMA classes but not by Muay Thai', () => {
        const pack = sub({ directionIds: [BJJ, MMA] })
        expect(pick([pack], BJJ)).toBe(pack.id)
        expect(pick([pack], MMA)).toBe(pack.id)
        expect(pick([pack], MT)).toBeNull()
    })

    it('a BJJ class draws the BJJ pack before a club-wide one', () => {
        const clubWide = sub({ endDate: day(15) })
        const bjj = sub({ directionIds: [BJJ], endDate: day(29) })
        expect(pick([clubWide, bjj], BJJ)).toBe(bjj.id)
        // …even when the club-wide one ends sooner and was sold first.
        expect(rank([clubWide, bjj], BJJ)).toEqual([bjj.id, clubWide.id])
    })

    it('a Muay Thai class falls back to the club-wide pack', () => {
        const clubWide = sub()
        const bjj = sub({ directionIds: [BJJ] })
        expect(pick([bjj, clubWide], MT)).toBe(clubWide.id)
    })

    it('a class without a direction uses only club-wide abonements', () => {
        const bjj = sub({ directionIds: [BJJ] })
        expect(pick([bjj], null)).toBeNull()
        const clubWide = sub()
        expect(pick([bjj, clubWide], null)).toBe(clubWide.id)
    })

    it('the narrowest scope wins among scoped ones', () => {
        const wide = sub({ directionIds: [BJJ, MMA, MT], endDate: day(12) })
        const narrow = sub({ directionIds: [BJJ], endDate: day(28) })
        const middle = sub({ directionIds: [BJJ, MMA], endDate: day(11) })
        expect(rank([wide, middle, narrow], BJJ)).toEqual([
            narrow.id,
            middle.id,
            wide.id,
        ])
    })

    it('with the same scope, the one ending soonest is used first', () => {
        const later = sub({ endDate: day(25) })
        const sooner = sub({ endDate: day(20) })
        expect(pick([later, sooner], BJJ)).toBe(sooner.id)
    })

    it('an open-ended one (not started yet / no end) comes after dated ones', () => {
        const pending = sub({
            startDate: null,
            endDate: null,
            startsOnFirstVisit: true,
            createdAt: day(2),
        })
        const dated = sub({ endDate: day(28), createdAt: day(5) })
        expect(rank([pending, dated], BJJ)).toEqual([dated.id, pending.id])
    })

    it('ties fall to the older sale, then the id', () => {
        const a = sub({ id: 'b', createdAt: day(3) })
        const b = sub({ id: 'a', createdAt: day(2) })
        const c = sub({ id: 'c', createdAt: day(2) })
        expect(rank([a, c, b], BJJ)).toEqual(['a', 'c', 'b'])
        expect(compareVisitPrecedence(b, b)).toBe(0)
    })

    it('a frozen pack is skipped and the other one is used', () => {
        const frozenBjj = sub({ directionIds: [BJJ], frozen: true })
        const clubWide = sub()
        expect(pick([frozenBjj, clubWide], BJJ)).toBe(clubWide.id)
        expect(pick([frozenBjj], BJJ)).toBeNull()
    })

    it('an exhausted narrow pack lets the next matching one pay', () => {
        const emptyBjj = sub({ directionIds: [BJJ], classesRemaining: 0 })
        const clubWide = sub()
        expect(pick([emptyBjj, clubWide], BJJ)).toBe(clubWide.id)
    })

    it('a time-based abonement of the class direction beats a club-wide pack', () => {
        const unlimitedBjj = sub({
            directionIds: [BJJ],
            classesTotal: null,
            classesRemaining: null,
        })
        const pack = sub()
        expect(pick([pack, unlimitedBjj], BJJ)).toBe(unlimitedBjj.id)
    })

    it('one abonement behaves exactly as before', () => {
        const only = sub()
        expect(pick([only], BJJ)).toBe(only.id)
        expect(pick([only], null)).toBe(only.id)
        expect(pick([sub({ classesRemaining: 0 })], null)).toBeNull()
        expect(pick([], BJJ)).toBeNull()
    })

    it('does not reorder the input list', () => {
        const a = sub({ endDate: day(25) })
        const b = sub({ endDate: day(20) })
        const input = [a, b]
        rank(input, BJJ)
        expect(input).toEqual([a, b])
    })
})

describe('toVisitAbonement', () => {
    it('maps a loaded candidate to the DTO', () => {
        const direction = { id: BJJ, name: 'БЖЖ', color: null, icon: null }
        expect(
            toVisitAbonement({
                ...sub({ id: 's1', directionIds: [BJJ] }),
                userId: 'u1',
                planName: 'БЖЖ 12',
                directions: [direction],
            }),
        ).toEqual({
            subscriptionId: 's1',
            planName: 'БЖЖ 12',
            classesTotal: 12,
            classesRemaining: 6,
            endDate: day(30).toISOString(),
            directions: [direction],
        })
    })
})

describe('loadVisitCandidates', () => {
    it('returns an empty map without querying when there is nobody', async () => {
        const db = { subscription: { findMany: jest.fn() } }
        const res = await loadVisitCandidates(db as never, {
            workspaceId: 'w',
            userIds: [],
            dayYmd: '2026-11-10',
            now: NOW,
        })
        expect(res.size).toBe(0)
        expect(db.subscription.findMany).not.toHaveBeenCalled()
    })

    it('loads current abonements of this club with scope and freeze of the day', async () => {
        const db = {
            subscription: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 's1',
                        status: 'ACTIVE',
                        startDate: day(1),
                        endDate: day(30),
                        createdAt: day(1),
                        classesTotal: 12,
                        classesRemaining: 5,
                        startsOnFirstVisit: false,
                        plan: { name: 'БЖЖ 12' },
                        workspaceMember: { userId: 'u1' },
                        directions: [
                            {
                                directionId: BJJ,
                                direction: { id: BJJ, name: 'БЖЖ', color: null, icon: null },
                            },
                        ],
                        freezes: [{ id: 'f1' }],
                    },
                    {
                        id: 's2',
                        status: 'ACTIVE',
                        startDate: day(1),
                        endDate: null,
                        createdAt: day(1),
                        classesTotal: null,
                        classesRemaining: null,
                        startsOnFirstVisit: false,
                        plan: { name: 'Безлимит' },
                        workspaceMember: { userId: 'u1' },
                        directions: [],
                        freezes: [],
                    },
                    // A row without a member (bought by a since-removed member) is skipped.
                    {
                        id: 's3',
                        status: 'ACTIVE',
                        startDate: day(1),
                        endDate: null,
                        createdAt: day(1),
                        classesTotal: null,
                        classesRemaining: null,
                        startsOnFirstVisit: false,
                        plan: { name: 'x' },
                        workspaceMember: null,
                        directions: [],
                        freezes: [],
                    },
                ]),
            },
        }
        const res = await loadVisitCandidates(db as never, {
            workspaceId: 'w1',
            userIds: ['u1', 'u2'],
            dayYmd: '2026-11-10',
            now: NOW,
        })
        const args = db.subscription.findMany.mock.calls[0][0]
        expect(args.where).toMatchObject({
            workspaceId: 'w1',
            workspaceMember: { userId: { in: ['u1', 'u2'] } },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: NOW } }],
        })
        expect(args.select.freezes.where).toEqual({
            fromDate: { lte: new Date('2026-11-10T00:00:00Z') },
            untilDate: { gte: new Date('2026-11-10T00:00:00Z') },
        })
        const u1 = res.get('u1')!
        expect(u1.map((c) => [c.id, c.frozen, c.directionIds])).toEqual([
            ['s1', true, [BJJ]],
            ['s2', false, []],
        ])
        expect(res.has('u2')).toBe(false)
        // The frozen BJJ pack is skipped: the BJJ class goes to the unlimited one.
        expect(pick(u1, BJJ)).toBe('s2')
    })
})
