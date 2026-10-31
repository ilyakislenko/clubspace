import { parseDateOnly } from './date-utils'
import { projectGroupOccurrences } from './schedule-projection'

const slot = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    dayOfWeek: 1,
    startTime: '19:00',
    durationMin: 90,
    effectiveFrom: null,
    effectiveUntil: null,
    ...over,
})

describe('projectGroupOccurrences', () => {
    // 2026-11-02 is a Monday.
    const from = parseDateOnly('2026-11-02')

    it('projects wall-clock slots in the gym zone, else the club zone', () => {
        const out = projectGroupOccurrences(
            [
                { gym: null, slots: [slot()], exceptions: [] },
                {
                    gym: { timezone: 'Asia/Novosibirsk' },
                    slots: [slot({ id: 's2' })],
                    exceptions: [],
                },
            ],
            from,
            7,
            'Europe/Moscow',
        )
        expect(out.map((o) => [o.slot.id, o.date, o.start.toISOString(), o.timezone])).toEqual([
            ['s1', '2026-11-02', '2026-11-02T16:00:00.000Z', 'Europe/Moscow'],
            ['s2', '2026-11-02', '2026-11-02T12:00:00.000Z', 'Asia/Novosibirsk'],
        ])
        expect(out[0].end.toISOString()).toBe('2026-11-02T17:30:00.000Z')
    })

    it('honours effective bounds', () => {
        const out = projectGroupOccurrences(
            [
                {
                    gym: null,
                    slots: [
                        slot({ effectiveFrom: parseDateOnly('2026-11-03') }),
                        slot({ id: 's2', effectiveUntil: parseDateOnly('2026-11-01') }),
                    ],
                    exceptions: [],
                },
            ],
            from,
            7,
            'UTC',
        )
        expect(out).toEqual([])
    })

    it('marks group-wide and slot exceptions as cancelled with the reason', () => {
        const day = parseDateOnly('2026-11-02')
        const out = projectGroupOccurrences(
            [
                {
                    gym: null,
                    slots: [slot(), slot({ id: 's2', startTime: '10:00' })],
                    exceptions: [
                        { slotId: 's2', fromDate: day, untilDate: day, reason: 'Ремонт' },
                    ],
                },
            ],
            from,
            1,
            'UTC',
        )
        expect(out.map((o) => [o.slot.id, o.cancelled, o.cancellationReason])).toEqual([
            ['s1', false, null],
            ['s2', true, 'Ремонт'],
        ])
        const whole = projectGroupOccurrences(
            [
                {
                    gym: null,
                    slots: [slot()],
                    exceptions: [{ slotId: null, fromDate: day, untilDate: day, reason: null }],
                },
            ],
            from,
            1,
            'UTC',
        )
        expect(whole[0].cancelled).toBe(true)
    })
})
