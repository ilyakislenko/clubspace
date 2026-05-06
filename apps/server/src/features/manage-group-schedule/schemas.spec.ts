import {
    isoDate,
    serializeException,
    serializeSlot,
} from './schemas'

describe('isoDate', () => {
    it('formats a date-only Prisma Date as YYYY-MM-DD without TZ math', () => {
        // Prisma's @db.Date columns surface as Date objects pinned to
        // UTC midnight. Slicing the ISO string preserves the calendar
        // date verbatim — no offset shifts.
        const d = new Date(Date.UTC(2026, 4, 8)) // 8 May 2026 UTC
        expect(isoDate(d)).toBe('2026-05-08')
    })
})

describe('serializeSlot', () => {
    it('passes through fields and ISO-formats date bounds', () => {
        const out = serializeSlot({
            id: 'slot-1',
            dayOfWeek: 2,
            startTime: '19:00',
            durationMin: 90,
            effectiveFrom: new Date(Date.UTC(2026, 8, 1)),
            effectiveUntil: null,
        })
        expect(out).toEqual({
            id: 'slot-1',
            dayOfWeek: 2,
            startTime: '19:00',
            durationMin: 90,
            effectiveFrom: '2026-09-01',
            effectiveUntil: null,
        })
    })
})

describe('serializeException', () => {
    it('renders date-only fields and preserves nulls', () => {
        const out = serializeException({
            id: 'e-1',
            slotId: null,
            fromDate: new Date(Date.UTC(2026, 5, 1)),
            untilDate: new Date(Date.UTC(2026, 5, 14)),
            reason: 'Отпуск',
        })
        expect(out).toEqual({
            id: 'e-1',
            slotId: null,
            fromDate: '2026-06-01',
            untilDate: '2026-06-14',
            reason: 'Отпуск',
        })
    })
})
