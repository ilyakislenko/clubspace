import {
    adhocOccurrenceKey,
    eventOccurrenceKey,
    formatLocalDateTimeRu,
    isSlotActiveOn,
    isValidIanaTz,
    isoDayOfWeek,
    localDateInTz,
    localMinuteInTz,
    resolveDateWindow,
    resolveGroupSessionTz,
    resolveSlotOccurrence,
    scheduledOccurrenceKey,
    wallClockToUtc,
} from './attendance-utils'

describe('occurrenceKey formatters', () => {
    it('scheduled', () =>
        expect(scheduledOccurrenceKey('s1', '2026-07-02')).toBe(
            'slot:s1:2026-07-02',
        ))
    it('adhoc', () =>
        expect(adhocOccurrenceKey('g1', '2026-07-02T19:00')).toBe(
            'adhoc:g1:2026-07-02T19:00',
        ))
    it('event', () => expect(eventOccurrenceKey('e1')).toBe('event:e1'))
})

describe('tz-local formatting', () => {
    // Asia/Krasnoyarsk is UTC+7 (no DST): 16:00Z -> 23:00 local.
    const inst = new Date('2026-07-02T16:00:00Z')
    it('localMinuteInTz floors to the minute in the zone', () =>
        expect(localMinuteInTz(inst, 'Asia/Krasnoyarsk')).toBe(
            '2026-07-02T23:00',
        ))
    it('localDateInTz is the first 10 chars', () =>
        expect(localDateInTz(inst, 'Asia/Krasnoyarsk')).toBe('2026-07-02'))
    it('same instant rolls to next day across a zone', () =>
        expect(
            localDateInTz(
                new Date('2026-07-02T23:30:00Z'),
                'Asia/Krasnoyarsk',
            ),
        ).toBe('2026-07-03'))
})

describe('resolveGroupSessionTz', () => {
    it('prefers gym tz', () =>
        expect(resolveGroupSessionTz('Asia/Tomsk', 'Europe/Moscow')).toBe(
            'Asia/Tomsk',
        ))
    it('falls back to workspace tz', () =>
        expect(resolveGroupSessionTz(null, 'Europe/Moscow')).toBe(
            'Europe/Moscow',
        ))
})

describe('isoDayOfWeek', () => {
    it('Thursday 2026-07-02 -> 4', () =>
        expect(isoDayOfWeek(new Date('2026-07-02T00:00:00Z'))).toBe(4))
    it('Sunday 2026-07-05 -> 7', () =>
        expect(isoDayOfWeek(new Date('2026-07-05T00:00:00Z'))).toBe(7))
})

describe('wallClockToUtc', () => {
    it('19:00 Europe/Moscow (+3) -> 16:00Z', () =>
        expect(wallClockToUtc('2026-07-02T19:00', 'Europe/Moscow').toISOString()).toBe(
            '2026-07-02T16:00:00.000Z',
        ))
})

describe('isSlotActiveOn', () => {
    const slot = { dayOfWeek: 4, effectiveFrom: null, effectiveUntil: null }
    const thu = new Date('2026-07-02T00:00:00Z')
    it('active on matching weekday', () =>
        expect(isSlotActiveOn(slot, 's1', thu, [])).toBe(true))
    it('inactive on wrong weekday', () =>
        expect(
            isSlotActiveOn(slot, 's1', new Date('2026-07-03T00:00:00Z'), []),
        ).toBe(false))
    it('inactive before effectiveFrom', () =>
        expect(
            isSlotActiveOn(
                { ...slot, effectiveFrom: new Date('2026-08-01T00:00:00Z') },
                's1',
                thu,
                [],
            ),
        ).toBe(false))
    it('cancelled by a covering slot-specific exception', () =>
        expect(
            isSlotActiveOn(slot, 's1', thu, [
                {
                    slotId: 's1',
                    fromDate: new Date('2026-07-01T00:00:00Z'),
                    untilDate: new Date('2026-07-03T00:00:00Z'),
                },
            ]),
        ).toBe(false))
    it('cancelled by a group-wide exception (slotId null)', () =>
        expect(
            isSlotActiveOn(slot, 's1', thu, [
                { slotId: null, fromDate: thu, untilDate: thu },
            ]),
        ).toBe(false))
    it('unaffected by an exception for another slot', () =>
        expect(
            isSlotActiveOn(slot, 's1', thu, [
                { slotId: 's2', fromDate: thu, untilDate: thu },
            ]),
        ).toBe(true))
})

describe('resolveDateWindow', () => {
    const opts = { defaultDays: 30, maxDays: 90 }
    it('accepts a valid explicit range', () => {
        const w = resolveDateWindow('2026-07-01', '2026-07-31', opts)
        expect(w.error).toBeNull()
        expect(w.from.toISOString()).toBe('2026-07-01T00:00:00.000Z')
        expect(w.to.toISOString()).toBe('2026-07-31T23:59:59.999Z')
    })
    it('rejects an oversized range', () =>
        expect(
            resolveDateWindow('2026-01-01', '2026-12-31', opts).error,
        ).toMatch(/90 days/))
    it('rejects from after to', () =>
        expect(
            resolveDateWindow('2026-07-10', '2026-07-01', opts).error,
        ).toMatch(/before/))
    it('defaults to a lookback window when unset', () => {
        const w = resolveDateWindow(undefined, undefined, opts)
        expect(w.error).toBeNull()
        const spanDays = (w.to.getTime() - w.from.getTime()) / 86_400_000
        expect(spanDays).toBeCloseTo(30, 0)
    })
})

describe('isValidIanaTz', () => {
    it('accepts a real zone', () =>
        expect(isValidIanaTz('Europe/Moscow')).toBe(true))
    it('rejects garbage (Cyrillic с)', () =>
        expect(isValidIanaTz('Europe/Mosсow')).toBe(false))
})

describe('resolveSlotOccurrence', () => {
    // 2026-10-31 is a Saturday (ISO 6).
    const slot = {
        id: 's1',
        dayOfWeek: 6,
        startTime: '19:00',
        durationMin: 90,
        effectiveFrom: null,
        effectiveUntil: null,
    }
    const base = {
        slot,
        sessionDate: '2026-10-31',
        gymTz: 'Asia/Tomsk',
        workspaceTz: 'Europe/Moscow',
        exceptions: [],
    }

    it('active slot: scheduled, not cancelled, start in the gym zone', () => {
        const occ = resolveSlotOccurrence(base)
        expect(occ.scheduled).toBe(true)
        expect(occ.cancelled).toBe(false)
        expect(occ.cancellationReason).toBeNull()
        expect(occ.timezone).toBe('Asia/Tomsk')
        // Tomsk is UTC+7: 19:00 local -> 12:00Z.
        expect(occ.startAt.toISOString()).toBe('2026-10-31T12:00:00.000Z')
        expect(occ.endAt.toISOString()).toBe('2026-10-31T13:30:00.000Z')
    })

    it('falls back to the workspace zone without a gym zone', () => {
        const occ = resolveSlotOccurrence({ ...base, gymTz: null })
        expect(occ.timezone).toBe('Europe/Moscow')
        expect(occ.startAt.toISOString()).toBe('2026-10-31T16:00:00.000Z')
    })

    it('is not scheduled on another weekday', () => {
        expect(
            resolveSlotOccurrence({ ...base, sessionDate: '2026-11-01' })
                .scheduled,
        ).toBe(false)
    })

    it('respects effectiveFrom / effectiveUntil', () => {
        expect(
            resolveSlotOccurrence({
                ...base,
                slot: { ...slot, effectiveFrom: new Date('2026-11-01T00:00:00Z') },
            }).scheduled,
        ).toBe(false)
        expect(
            resolveSlotOccurrence({
                ...base,
                slot: { ...slot, effectiveUntil: new Date('2026-10-30T00:00:00Z') },
            }).scheduled,
        ).toBe(false)
    })

    it('a group-wide exception cancels and passes the reason through', () => {
        const occ = resolveSlotOccurrence({
            ...base,
            exceptions: [
                {
                    slotId: null,
                    fromDate: new Date('2026-10-30T00:00:00Z'),
                    untilDate: new Date('2026-11-02T00:00:00Z'),
                    reason: 'Праздник',
                },
            ],
        })
        expect(occ.cancelled).toBe(true)
        expect(occ.cancellationReason).toBe('Праздник')
    })

    it('a slot exception cancels only its own slot', () => {
        const exception = {
            fromDate: new Date('2026-10-31T00:00:00Z'),
            untilDate: new Date('2026-10-31T00:00:00Z'),
            reason: null,
        }
        expect(
            resolveSlotOccurrence({
                ...base,
                exceptions: [{ ...exception, slotId: 's1' }],
            }).cancelled,
        ).toBe(true)
        expect(
            resolveSlotOccurrence({
                ...base,
                exceptions: [{ ...exception, slotId: 'other' }],
            }).cancelled,
        ).toBe(false)
    })
})

describe('formatLocalDateTimeRu', () => {
    it('renders dd.MM в HH:mm in the zone', () =>
        expect(
            formatLocalDateTimeRu(
                new Date('2026-10-31T12:00:00Z'),
                'Asia/Tomsk',
            ),
        ).toBe('31.10 в 19:00'))
})
