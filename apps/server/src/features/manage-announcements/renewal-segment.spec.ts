import {
    expiringSegmentWhere,
    isExpiringMember,
    lowestClassesRemaining,
    notAwaitingFirstVisitWhere,
} from './renewal-segment'

const now = new Date('2026-07-23T12:00:00Z')
const days = (n: number) => new Date(now.getTime() + n * 24 * 3600 * 1000)

describe('isExpiringMember', () => {
    it('is true when access expires within a week (or already has)', () => {
        expect(
            isExpiringMember({ accessUntil: days(3), classesRemaining: null }, now),
        ).toBe(true)
        expect(
            isExpiringMember({ accessUntil: days(-5), classesRemaining: null }, now),
        ).toBe(true)
    })

    it('is true when the class-pack is on its last visit', () => {
        expect(
            isExpiringMember({ accessUntil: days(60), classesRemaining: 1 }, now),
        ).toBe(true)
        expect(
            isExpiringMember({ accessUntil: days(60), classesRemaining: 0 }, now),
        ).toBe(true)
    })

    it('does not call a pending abonement’s provisional window expiring', () => {
        expect(
            isExpiringMember(
                {
                    accessUntil: days(3),
                    classesRemaining: null,
                    awaitingFirstVisit: true,
                },
                now,
            ),
        ).toBe(false)
    })

    it('is false with far access and classes to spare (or no limits)', () => {
        expect(
            isExpiringMember({ accessUntil: days(60), classesRemaining: 5 }, now),
        ).toBe(false)
        expect(
            isExpiringMember({ accessUntil: null, classesRemaining: null }, now),
        ).toBe(false)
    })
})

describe('expiringSegmentWhere', () => {
    it('ORs an access-window cutoff with a low-classes filter', () => {
        const where = expiringSegmentWhere(now)
        expect(where.OR).toHaveLength(2)
        // First clause: accessUntil lte a future cutoff.
        const accessClause = where.OR?.[0] as {
            accessUntil: { lte: Date }
        }
        expect(accessClause.accessUntil.lte.getTime()).toBeGreaterThan(
            now.getTime(),
        )
        // ...but never for an abonement still waiting for its first visit.
        expect(where.OR?.[0]).toMatchObject(notAwaitingFirstVisitWhere)
    })
})

describe('expiringSegmentWhere over several abonements', () => {
    it('counts a low pack only among the member’s current abonements', () => {
        const where = expiringSegmentWhere(now)
        expect(where.OR?.[1]).toEqual({
            subscriptions: {
                some: {
                    NOT: { workspaceMemberId: null },
                    status: 'ACTIVE',
                    OR: [{ endDate: null }, { endDate: { gt: now } }],
                    classesRemaining: { lte: 1 },
                },
            },
        })
    })

    it('treats the window as provisional while any abonement awaits its first visit', () => {
        expect(notAwaitingFirstVisitWhere).toEqual({
            subscriptions: { none: { status: 'ACTIVE', startDate: null } },
        })
    })
})

describe('lowestClassesRemaining', () => {
    it('is the lowest balance among class packs, null without any pack', () => {
        expect(lowestClassesRemaining([])).toBeNull()
        expect(lowestClassesRemaining([{ classesRemaining: null }])).toBeNull()
        expect(
            lowestClassesRemaining([
                { classesRemaining: 7 },
                { classesRemaining: null },
                { classesRemaining: 1 },
            ]),
        ).toBe(1)
    })
})
