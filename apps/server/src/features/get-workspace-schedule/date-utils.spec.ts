import {
    addDays,
    daysBetween,
    endOfDayUtc,
    isoDateString,
    isoDayOfWeek,
    parseDateOnly,
} from './date-utils'

describe('parseDateOnly', () => {
    it('returns UTC midnight for the given calendar date', () => {
        const d = parseDateOnly('2026-05-08')
        expect(d.toISOString()).toBe('2026-05-08T00:00:00.000Z')
    })
})

describe('addDays', () => {
    it('moves forward exactly 86_400_000 ms per day', () => {
        const d = parseDateOnly('2026-05-08')
        expect(addDays(d, 0).toISOString()).toBe('2026-05-08T00:00:00.000Z')
        expect(addDays(d, 1).toISOString()).toBe('2026-05-09T00:00:00.000Z')
        expect(addDays(d, 7).toISOString()).toBe('2026-05-15T00:00:00.000Z')
    })
    it('moves backward for negative offsets', () => {
        const d = parseDateOnly('2026-05-08')
        expect(addDays(d, -1).toISOString()).toBe('2026-05-07T00:00:00.000Z')
    })
})

describe('daysBetween', () => {
    it('returns whole-day difference, rounded', () => {
        expect(
            daysBetween(parseDateOnly('2026-05-01'), parseDateOnly('2026-05-08')),
        ).toBe(7)
    })
    it('is zero for the same date', () => {
        const d = parseDateOnly('2026-05-08')
        expect(daysBetween(d, d)).toBe(0)
    })
})

describe('isoDayOfWeek', () => {
    // 2026-05-04 is a Monday. Walking forward gives the rest.
    const cases: Array<[string, number]> = [
        ['2026-05-04', 1],
        ['2026-05-05', 2],
        ['2026-05-06', 3],
        ['2026-05-07', 4],
        ['2026-05-08', 5],
        ['2026-05-09', 6],
        ['2026-05-10', 7],
    ]
    it.each(cases)('%s -> ISO %d', (date, expected) => {
        expect(isoDayOfWeek(parseDateOnly(date))).toBe(expected)
    })
})

describe('isoDateString', () => {
    it('slices the UTC ISO string', () => {
        expect(isoDateString(parseDateOnly('2026-05-08'))).toBe('2026-05-08')
    })
})

describe('endOfDayUtc', () => {
    it('returns the last millisecond of the same calendar day', () => {
        const start = parseDateOnly('2026-05-08')
        const end = endOfDayUtc(start)
        expect(end.toISOString()).toBe('2026-05-08T23:59:59.999Z')
    })
})
