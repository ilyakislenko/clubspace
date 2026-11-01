import {
    crossesMidnight,
    dateRangesOverlap,
    parseTimeToMinutes,
    slotsOverlap,
} from './slot-utils'

describe('parseTimeToMinutes', () => {
    it.each([
        ['00:00', 0],
        ['00:01', 1],
        ['01:00', 60],
        ['09:30', 9 * 60 + 30],
        ['19:00', 19 * 60],
        ['23:59', 23 * 60 + 59],
    ])('parses %s -> %d', (input, expected) => {
        expect(parseTimeToMinutes(input)).toBe(expected)
    })
})

describe('slotsOverlap', () => {
    const slot = (startTime: string, durationMin: number) => ({
        startTime,
        durationMin,
    })

    it('detects clear overlap', () => {
        expect(
            slotsOverlap(slot('19:00', 90), slot('20:00', 60)),
        ).toBe(true)
    })

    it('treats end-touch as non-overlap', () => {
        // 19:00–20:00 and 20:00–21:00 — the second picks up exactly
        // when the first ends, so they do not overlap.
        expect(
            slotsOverlap(slot('19:00', 60), slot('20:00', 60)),
        ).toBe(false)
    })

    it('detects fully-contained overlap', () => {
        expect(
            slotsOverlap(slot('19:00', 90), slot('19:30', 30)),
        ).toBe(true)
    })

    it('returns false when slots are far apart', () => {
        expect(
            slotsOverlap(slot('09:00', 60), slot('19:00', 60)),
        ).toBe(false)
    })

    it('handles slot ordering both ways', () => {
        const a = slot('19:00', 90)
        const b = slot('19:30', 30)
        expect(slotsOverlap(a, b)).toBe(slotsOverlap(b, a))
    })
})

describe('crossesMidnight', () => {
    it('flags slots that bleed past 24:00', () => {
        expect(crossesMidnight({ startTime: '23:30', durationMin: 60 })).toBe(
            true,
        )
    })

    it('lets a slot end at exactly 24:00', () => {
        // "23:00–24:00" finishes at midnight without rolling over —
        // we count this as still inside a single calendar day.
        expect(crossesMidnight({ startTime: '23:00', durationMin: 60 })).toBe(
            false,
        )
    })

    it('lets sane evening slots through', () => {
        expect(crossesMidnight({ startTime: '19:00', durationMin: 90 })).toBe(
            false,
        )
    })
})

describe('dateRangesOverlap', () => {
    const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`)

    it('treats open ends as unbounded', () => {
        expect(dateRangesOverlap(null, null, d('2026-11-02'), d('2026-11-02'))).toBe(true)
        expect(dateRangesOverlap(d('2026-11-09'), null, null, d('2026-11-09'))).toBe(true)
    })

    it('touching on one day overlaps (inclusive bounds)', () => {
        expect(
            dateRangesOverlap(d('2026-11-02'), d('2026-11-09'), d('2026-11-09'), null),
        ).toBe(true)
    })

    it('a series cut before another starts does not overlap', () => {
        expect(
            dateRangesOverlap(null, d('2026-11-08'), d('2026-11-09'), null),
        ).toBe(false)
        expect(
            dateRangesOverlap(d('2026-11-09'), null, null, d('2026-11-08')),
        ).toBe(false)
    })

    it('a one-off outside a bounded series does not overlap', () => {
        expect(
            dateRangesOverlap(
                d('2026-12-01'),
                d('2026-12-01'),
                d('2026-11-01'),
                d('2026-11-30'),
            ),
        ).toBe(false)
    })
})
