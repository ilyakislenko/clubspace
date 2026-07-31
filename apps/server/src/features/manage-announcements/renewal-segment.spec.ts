import { expiringSegmentWhere, isExpiringMember } from './renewal-segment'

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
    })
})
