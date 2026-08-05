import {
    DAY_SHORT,
    findActiveGroupException,
    findExceptionForSlot,
    findNextSession,
    formatDuration,
    formatNextSessionLabel,
    formatSlotShort,
    isoDateString,
    isoDayOfWeek,
    parseHHMM,
} from './schedule-helpers'

const slot = (overrides: Partial<{
    id: string
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom: string | null
    effectiveUntil: string | null
}> = {}) => ({
    id: overrides.id ?? 's-1',
    dayOfWeek: overrides.dayOfWeek ?? 2, // Tuesday
    startTime: overrides.startTime ?? '19:00',
    durationMin: overrides.durationMin ?? 90,
    effectiveFrom: overrides.effectiveFrom ?? null,
    effectiveUntil: overrides.effectiveUntil ?? null,
})

const exception = (overrides: Partial<{
    id: string
    slotId: string | null
    fromDate: string
    untilDate: string
    reason: string | null
}> = {}) => ({
    id: overrides.id ?? 'e-1',
    slotId: overrides.slotId ?? null,
    fromDate: overrides.fromDate ?? '2026-05-08',
    untilDate: overrides.untilDate ?? '2026-05-08',
    reason: overrides.reason ?? null,
})

describe('isoDayOfWeek', () => {
    // 2026-05-04 is a Monday — known landmark used for several tests.
    it.each([
        [new Date(2026, 4, 4), 1], // Mon
        [new Date(2026, 4, 5), 2], // Tue
        [new Date(2026, 4, 9), 6], // Sat
        [new Date(2026, 4, 10), 7], // Sun
    ])('%s -> ISO %d', (d, expected) => {
        expect(isoDayOfWeek(d as Date)).toBe(expected)
    })
})

describe('parseHHMM', () => {
    it('parses common shapes', () => {
        expect(parseHHMM('19:00')).toEqual({ hour: 19, minute: 0 })
        expect(parseHHMM('07:05')).toEqual({ hour: 7, minute: 5 })
    })
})

describe('formatDuration', () => {
    it('uses minutes for sub-hour', () => {
        expect(formatDuration(45)).toBe('45 мин')
    })
    it('drops the minute fragment when whole hours', () => {
        expect(formatDuration(60)).toBe('1 ч')
        expect(formatDuration(120)).toBe('2 ч')
    })
    it('combines hours and minutes', () => {
        expect(formatDuration(90)).toBe('1 ч 30 мин')
    })
})

describe('formatSlotShort', () => {
    it('renders day short + start time', () => {
        expect(
            formatSlotShort(slot({ dayOfWeek: 3, startTime: '19:00' })),
        ).toBe(`${DAY_SHORT[3]} 19:00`)
    })
})

describe('findExceptionForSlot', () => {
    it('matches an exception with explicit slotId on the right date', () => {
        const s = slot({ id: 's-1' })
        const e = exception({ slotId: 's-1', fromDate: '2026-05-08' })
        expect(findExceptionForSlot([e], s, '2026-05-08')).toBe(e)
    })

    it('matches an exception with slotId null (whole-group skip)', () => {
        const s = slot({ id: 's-1' })
        const e = exception({
            slotId: null,
            fromDate: '2026-06-01',
            untilDate: '2026-06-14',
        })
        expect(findExceptionForSlot([e], s, '2026-06-08')).toBe(e)
    })

    it('does not match when slotId is set to a different slot', () => {
        const s = slot({ id: 's-1' })
        const e = exception({ slotId: 'other-slot' })
        expect(findExceptionForSlot([e], s, '2026-05-08')).toBeNull()
    })

    it('does not match outside the date range', () => {
        const s = slot({ id: 's-1' })
        const e = exception({ fromDate: '2026-05-10', untilDate: '2026-05-20' })
        expect(findExceptionForSlot([e], s, '2026-05-09')).toBeNull()
    })
})

describe('findActiveGroupException', () => {
    it('only returns whole-group exceptions covering today', () => {
        const today = new Date(2026, 5, 5) // 5 Jun 2026
        const vacation = exception({
            slotId: null,
            fromDate: '2026-06-01',
            untilDate: '2026-06-14',
        })
        const slotSpecific = exception({
            slotId: 's-1',
            fromDate: '2026-06-05',
            untilDate: '2026-06-05',
        })
        expect(
            findActiveGroupException([vacation, slotSpecific], today),
        ).toBe(vacation)
    })

    it('returns null when no whole-group exception covers today', () => {
        const today = new Date(2026, 5, 5)
        expect(findActiveGroupException([], today)).toBeNull()
    })
})

describe('findNextSession', () => {
    // Anchor "now" to 2026-05-04 09:00 (Monday morning) — predictable
    // weekday so we can reason about offsets without a real clock.
    const monday0900 = new Date(2026, 4, 4, 9, 0)

    it('picks today when a slot is later today', () => {
        const tueSlot = slot({ dayOfWeek: 1, startTime: '19:00' }) // Mon 19:00
        const next = findNextSession([tueSlot], [], monday0900)
        expect(next).not.toBeNull()
        expect(next!.daysAhead).toBe(0)
        expect(next!.slot).toBe(tueSlot)
    })

    it('skips today when its slot already ended', () => {
        const earlierToday = slot({ dayOfWeek: 1, startTime: '07:00' })
        const next = findNextSession([earlierToday], [], monday0900)
        // 07:00 + 90 min = 08:30 finished before now=09:00. Still picks
        // it next Monday — 7 days ahead.
        expect(next).not.toBeNull()
        expect(next!.daysAhead).toBe(7)
    })

    it('returns null when no slot lands inside 14 days', () => {
        // Effective only after 6 months — out of the lookahead horizon.
        const farSlot = slot({
            dayOfWeek: 1,
            startTime: '19:00',
            effectiveFrom: '2026-12-01',
        })
        expect(findNextSession([farSlot], [], monday0900)).toBeNull()
    })

    it('skips a slot that is cancelled by a matching exception', () => {
        const tonight = slot({ dayOfWeek: 1, startTime: '19:00' })
        const cancelled = exception({
            slotId: 's-1',
            fromDate: '2026-05-04',
            untilDate: '2026-05-04',
        })
        const next = findNextSession([tonight], [cancelled], monday0900)
        // Should fast-forward to next Monday.
        expect(next!.daysAhead).toBe(7)
    })

    it('picks the earliest slot of the matching day', () => {
        const earlier = slot({
            id: 'a',
            dayOfWeek: 2,
            startTime: '08:00',
        })
        const later = slot({
            id: 'b',
            dayOfWeek: 2,
            startTime: '19:00',
        })
        const next = findNextSession(
            [later, earlier],
            [],
            monday0900,
        )
        expect(next!.slot.id).toBe('a')
        expect(next!.daysAhead).toBe(1)
    })
})

describe('formatNextSessionLabel', () => {
    it('renders сегодня / завтра / в день недели', () => {
        const monday = new Date(2026, 4, 4, 19, 0) // Mon 19:00
        const today = formatNextSessionLabel({
            slot: slot({ startTime: '19:00' }),
            startAt: monday,
            dateStr: '2026-05-04',
            daysAhead: 0,
        })
        expect(today).toBe('Сегодня в 19:00')

        const tomorrow = formatNextSessionLabel({
            slot: slot({ startTime: '07:00' }),
            startAt: new Date(2026, 4, 5, 7, 0),
            dateStr: '2026-05-05',
            daysAhead: 1,
        })
        expect(tomorrow).toBe('Завтра в 07:00')

        const wednesday = formatNextSessionLabel({
            slot: slot({ startTime: '20:00' }),
            startAt: new Date(2026, 4, 6, 20, 0),
            dateStr: '2026-05-06',
            daysAhead: 2,
        })
        // Russian dative case for "среду" — keeps the sentence natural.
        expect(wednesday).toBe('В среду в 20:00')
    })
})

describe('isoDateString', () => {
    it('formats local YYYY-MM-DD without TZ shifts', () => {
        expect(isoDateString(new Date(2026, 4, 8))).toBe('2026-05-08')
        expect(isoDateString(new Date(2026, 0, 1))).toBe('2026-01-01')
    })
})
