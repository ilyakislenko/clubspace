import {
    DAY_SHORT,
    findActiveGroupException,
    findExceptionForSlot,
    findNextAcrossGroups,
    findNextSession,
    findTodaySlot,
    foreignTzSuffix,
    formatDuration,
    formatNextSessionLabel,
    formatSlotShort,
    formatUpcomingLabel,
    isoDateString,
    isoDayOfWeek,
    parseHHMM,
    zonedWallTimeToDate,
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

describe('findTodaySlot', () => {
    // 2026-10-27 is a Tuesday.
    const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m)

    it('returns null when nothing runs today', () => {
        expect(findTodaySlot([slot({ dayOfWeek: 3 })], [], at(12))).toBeNull()
    })

    it('prefers the latest slot that has already started', () => {
        const a = slot({ id: 'a', startTime: '10:00' })
        const b = slot({ id: 'b', startTime: '19:00' })
        expect(findTodaySlot([b, a], [], at(20))?.slot.id).toBe('b')
        expect(findTodaySlot([b, a], [], at(12))?.slot.id).toBe('a')
    })

    it('falls back to the earliest upcoming slot', () => {
        const a = slot({ id: 'a', startTime: '18:00' })
        const b = slot({ id: 'b', startTime: '20:00' })
        const hit = findTodaySlot([b, a], [], at(9))
        expect(hit?.slot.id).toBe('a')
        expect(hit?.dateStr).toBe('2026-10-27')
    })

    it('skips a slot cancelled by an exception', () => {
        const e = exception({ fromDate: '2026-10-27', untilDate: '2026-10-27' })
        expect(findTodaySlot([slot()], [e], at(12))).toBeNull()
    })
})

describe('findNextAcrossGroups', () => {
    // Monday 2026-05-04 10:00
    const now = new Date(2026, 4, 4, 10, 0)
    const group = (id: string, slots: ReturnType<typeof slot>[]) =>
        ({ id, name: id, slots, exceptions: [] }) as never

    it('picks the earliest session across groups', () => {
        const late = group('late', [slot({ dayOfWeek: 3, startTime: '19:00' })])
        const soon = group('soon', [slot({ dayOfWeek: 2, startTime: '18:00' })])
        const result = findNextAcrossGroups([late, soon], now)
        expect(result?.group).toBe(soon)
        expect(result?.next.dateStr).toBe('2026-05-05')
    })

    it('returns null for no groups', () => {
        expect(findNextAcrossGroups([], now)).toBeNull()
    })

    it('skips a group that has no slots', () => {
        const empty = group('empty', [])
        const real = group('real', [slot({ dayOfWeek: 4 })])
        expect(findNextAcrossGroups([empty, real], now)?.group).toBe(real)
        expect(findNextAcrossGroups([empty], now)).toBeNull()
    })
})

describe('club timezone', () => {
    const EKB = 'Asia/Yekaterinburg' // UTC+5
    const VLAD = 'Asia/Vladivostok' // UTC+10
    const BERLIN = 'Europe/Berlin'
    const MSK = 'Europe/Moscow' // UTC+3, the "device" below

    describe('zonedWallTimeToDate', () => {
        it('converts club wall time to the absolute instant', () => {
            expect(
                zonedWallTimeToDate(2026, 10, 27, 19, 0, EKB).toISOString(),
            ).toBe('2026-10-27T14:00:00.000Z')
        })

        it('honours DST on both sides of the autumn change (Berlin)', () => {
            // Sat 24 Oct is still CEST (+2), Sun 25 Oct is CET (+1).
            expect(
                zonedWallTimeToDate(2026, 10, 24, 10, 0, BERLIN).toISOString(),
            ).toBe('2026-10-24T08:00:00.000Z')
            expect(
                zonedWallTimeToDate(2026, 10, 25, 10, 0, BERLIN).toISOString(),
            ).toBe('2026-10-25T09:00:00.000Z')
        })

        it('honours DST on the spring change day (Berlin)', () => {
            expect(
                zonedWallTimeToDate(2026, 3, 29, 10, 0, BERLIN).toISOString(),
            ).toBe('2026-03-29T08:00:00.000Z')
            expect(
                zonedWallTimeToDate(2026, 3, 29, 1, 30, BERLIN).toISOString(),
            ).toBe('2026-03-29T00:30:00.000Z')
        })
    })

    describe('findTodaySlot', () => {
        // Tue 2026-10-27 18:30 in Yekaterinburg = 16:30 Moscow = 13:30Z.
        const now = new Date('2026-10-27T13:30:00Z')

        it('reads "now" in the club zone, not the device zone', () => {
            const afternoon = slot({ id: 'a', startTime: '17:00' })
            const evening = slot({ id: 'b', startTime: '19:00' })
            // Club 18:30: 18:00 is the latest started. Device (Moscow)
            // reads 16:30, where only 17:00 has started.
            const between = slot({ id: 'c', startTime: '18:00' })
            expect(
                findTodaySlot([afternoon, between, evening], [], now, EKB)?.slot
                    .id,
            ).toBe('c')
            expect(
                findTodaySlot([afternoon, between, evening], [], now, MSK)?.slot
                    .id,
            ).toBe('a')
        })

        it('uses the club calendar day across midnight (Vladivostok vs Moscow)', () => {
            // Mon 26 Oct 18:30 Moscow = Tue 27 Oct 01:30 Vladivostok.
            const instant = new Date('2026-10-26T15:30:00Z')
            const tuesday = slot({ dayOfWeek: 2, startTime: '08:00' })
            const monday = slot({ id: 'm', dayOfWeek: 1, startTime: '08:00' })
            const hit = findTodaySlot([monday, tuesday], [], instant, VLAD)
            expect(hit?.slot).toBe(tuesday)
            expect(hit?.dateStr).toBe('2026-10-27')
            expect(findTodaySlot([monday], [], instant, VLAD)).toBeNull()
        })

        it('matches exceptions on the club date', () => {
            const instant = new Date('2026-10-26T15:30:00Z')
            const e = exception({
                fromDate: '2026-10-27',
                untilDate: '2026-10-27',
            })
            expect(findTodaySlot([slot()], [e], instant, VLAD)).toBeNull()
            expect(findTodaySlot([slot()], [e], instant, MSK)).toBeNull()
        })

        it('falls back to the device zone without a timezone', () => {
            const local = new Date(2026, 9, 27, 12, 0)
            expect(findTodaySlot([slot()], [], local)?.dateStr).toBe(
                '2026-10-27',
            )
            expect(findTodaySlot([slot()], [], local, 'Not/AZone')?.dateStr).toBe(
                '2026-10-27',
            )
        })
    })

    describe('findNextSession', () => {
        it('picks the 19:00 club slot at 18:30 club time and returns the true instant', () => {
            const now = new Date('2026-10-27T13:30:00Z') // 18:30 EKB, 16:30 MSK
            const next = findNextSession(
                [slot({ startTime: '19:00' })],
                [],
                now,
                EKB,
            )
            expect(next?.daysAhead).toBe(0)
            expect(next?.startAt.toISOString()).toBe('2026-10-27T14:00:00.000Z')
        })

        it('does not treat a class that ended on the club clock as upcoming', () => {
            // 21:00 EKB: the 19:00 (90 min) class is over.
            const now = new Date('2026-10-27T16:00:00Z')
            const next = findNextSession([slot()], [], now, EKB)
            expect(next?.daysAhead).toBe(7)
        })

        it('counts days in the club zone across midnight', () => {
            // Mon 18:30 Moscow = Tue 01:30 Vladivostok; Tue slot is "today".
            const now = new Date('2026-10-26T15:30:00Z')
            const next = findNextSession(
                [slot({ dayOfWeek: 2, startTime: '08:00' })],
                [],
                now,
                VLAD,
            )
            expect(next?.daysAhead).toBe(0)
            expect(next?.dateStr).toBe('2026-10-27')
            expect(next?.startAt.toISOString()).toBe('2026-10-26T22:00:00.000Z')
        })

        it('is correct on the Berlin DST change day', () => {
            // Sat 24 Oct 22:00 Berlin (CEST); Sunday class is after the change.
            const now = new Date('2026-10-24T20:00:00Z')
            const next = findNextSession(
                [slot({ dayOfWeek: 7, startTime: '10:00' })],
                [],
                now,
                BERLIN,
            )
            expect(next?.daysAhead).toBe(1)
            expect(next?.dateStr).toBe('2026-10-25')
            expect(next?.startAt.toISOString()).toBe('2026-10-25T09:00:00.000Z')
        })

        it('falls back to the device zone without a timezone', () => {
            const now = new Date(2026, 4, 4, 9, 0)
            const next = findNextSession(
                [slot({ dayOfWeek: 1, startTime: '19:00' })],
                [],
                now,
            )
            expect(next?.daysAhead).toBe(0)
            expect(next?.startAt.getHours()).toBe(19)
        })
    })

    describe('findActiveGroupException', () => {
        it('checks the vacation against the club date', () => {
            const instant = new Date('2026-10-26T15:30:00Z')
            const vacation = exception({
                fromDate: '2026-10-27',
                untilDate: '2026-10-27',
            })
            expect(findActiveGroupException([vacation], instant, VLAD)).toBe(
                vacation,
            )
            expect(findActiveGroupException([vacation], instant, MSK)).toBeNull()
        })
    })

    describe('findNextAcrossGroups', () => {
        it('uses each group\'s own timezone', () => {
            // Tue 2026-10-27 01:30 Vladivostok / Mon 18:30 Moscow.
            const now = new Date('2026-10-26T15:30:00Z')
            const vlad = {
                id: 'v',
                name: 'v',
                timezone: VLAD,
                slots: [slot({ dayOfWeek: 2, startTime: '08:00' })],
                exceptions: [],
            } as never
            const moscow = {
                id: 'm',
                name: 'm',
                timezone: MSK,
                slots: [slot({ dayOfWeek: 1, startTime: '20:00' })],
                exceptions: [],
            } as never
            // Moscow 20:00 Mon = 17:00Z; Vladivostok 08:00 Tue = 22:00Z.
            expect(findNextAcrossGroups([vlad, moscow], now)?.group).toBe(moscow)
        })
    })

    describe('labels', () => {
        const next = {
            slot: slot({ startTime: '19:00' }),
            startAt: new Date('2026-10-27T14:00:00Z'),
            timeZone: EKB,
            dateStr: '2026-10-27',
            daysAhead: 0,
        }

        it('appends the club tz label when it differs from the device', () => {
            expect(formatNextSessionLabel(next, MSK)).toBe(
                'Сегодня в 19:00 GMT+5',
            )
        })

        it('stays plain when the device is in the club zone', () => {
            expect(formatNextSessionLabel(next, EKB)).toBe('Сегодня в 19:00')
        })

        it('names the weekday by the club date', () => {
            expect(
                formatNextSessionLabel(
                    { ...next, dateStr: '2026-10-29', daysAhead: 2 },
                    EKB,
                ),
            ).toBe('В четверг в 19:00')
        })

        it('foreignTzSuffix is empty without a club zone', () => {
            expect(foreignTzSuffix(undefined, new Date(), MSK)).toBe('')
        })
    })
})

describe('formatUpcomingLabel', () => {
    const EKB = 'Asia/Yekaterinburg'
    const MSK = 'Europe/Moscow'
    const now = new Date('2026-10-27T09:00:00Z') // Tue 14:00 in Yekaterinburg

    it('says today / tomorrow / the weekday, in the class zone', () => {
        expect(
            formatUpcomingLabel(new Date('2026-10-27T14:00:00Z'), EKB, now, EKB),
        ).toBe('Сегодня в 19:00')
        expect(
            formatUpcomingLabel(new Date('2026-10-28T14:00:00Z'), EKB, now, EKB),
        ).toBe('Завтра в 19:00')
        expect(
            formatUpcomingLabel(new Date('2026-10-30T14:00:00Z'), EKB, now, EKB),
        ).toBe('В пятницу в 19:00')
    })

    it('reads the day in the class zone, not UTC', () => {
        // 21:00 UTC on the 27th is already 02:00 on the 28th in Yekaterinburg.
        expect(
            formatUpcomingLabel(new Date('2026-10-27T21:00:00Z'), EKB, now, EKB),
        ).toBe('Завтра в 02:00')
    })

    it('appends the club zone when the phone is elsewhere', () => {
        expect(
            formatUpcomingLabel(new Date('2026-10-27T14:00:00Z'), EKB, now, MSK),
        ).toBe('Сегодня в 19:00 GMT+5')
    })
})
