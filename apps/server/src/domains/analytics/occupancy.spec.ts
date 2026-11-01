import {
    buildHeatmap,
    type OccurrenceRow,
    slotLabel,
    strongestSlots,
    suggestOccupancyActions,
    summarizeSlots,
    weakestSlots,
} from './occupancy'

const row = (over: Partial<OccurrenceRow>): OccurrenceRow => ({
    groupId: 'g1',
    slotId: 's1',
    gymId: 'gym1',
    sessionDate: '2026-10-05',
    dayOfWeek: 1,
    startTime: '19:00',
    held: true,
    attended: 10,
    roster: 20,
    capacity: null,
    booked: 0,
    missedBookings: 0,
    ...over,
})

describe('summarizeSlots', () => {
    it('is empty without classes', () => {
        expect(summarizeSlots([], '2026-01-01')).toEqual([])
        expect(buildHeatmap([]).size).toBe(0)
    })

    it('averages only the classes a coach took attendance for, inside the window', () => {
        const [s] = summarizeSlots(
            [
                row({ sessionDate: '2026-09-21', attended: 30 }), // before the window
                row({ sessionDate: '2026-10-05', attended: 12 }),
                row({ sessionDate: '2026-10-12', attended: 8, booked: 2, missedBookings: 1 }),
                row({ sessionDate: '2026-10-19', held: false, attended: 0, roster: 25 }),
            ],
            '2026-10-01',
        )
        expect(s).toEqual({
            slotId: 's1',
            groupId: 'g1',
            gymId: 'gym1',
            dayOfWeek: 1,
            startTime: '19:00',
            scheduled: 3,
            held: 2,
            avgAttendance: 10,
            // The latest roster is the capacity.
            capacity: 25,
            fill: 0.4,
            booked: 2,
            missedBookings: 1,
        })
    })

    it('prefers an explicit capacity over the roster and leaves fill empty at 0', () => {
        const [a, b] = summarizeSlots(
            [
                row({ slotId: 'a', capacity: 12, attended: 12 }),
                row({ slotId: 'b', dayOfWeek: 2, roster: 0, attended: 3 }),
            ],
            '2026-10-01',
        )
        expect(a).toMatchObject({ capacity: 12, fill: 1 })
        expect(b).toMatchObject({ capacity: 0, fill: null })
    })
})

describe('heatmap and rankings', () => {
    const slots = summarizeSlots(
        [
            // Mon 19:00 and 19:30 in gym1 share one hour cell.
            ...['2026-10-05', '2026-10-12'].flatMap((d) => [
                row({ slotId: 'mon19', sessionDate: d, attended: 19 }),
                row({ slotId: 'mon1930', groupId: 'g2', startTime: '19:30', sessionDate: d, attended: 5, roster: 10 }),
                row({ slotId: 'sat9', groupId: 'g3', dayOfWeek: 6, startTime: '09:00', sessionDate: d, attended: 2 }),
            ]),
            // Judged on one class only: never ranked.
            row({ slotId: 'once', groupId: 'g4', dayOfWeek: 3, gymId: 'gym2', attended: 0 }),
        ],
        '2026-10-01',
    )

    it('sums slots into weekday × hour cells per gym', () => {
        const map = buildHeatmap(slots)
        expect(map.get('gym1')).toEqual([
            { dayOfWeek: 1, hour: 19, slots: 2, avgAttendance: 24, capacity: 30, fill: 0.8 },
            { dayOfWeek: 6, hour: 9, slots: 1, avgAttendance: 2, capacity: 20, fill: 0.1 },
        ])
        expect(map.get('gym2')).toEqual([
            { dayOfWeek: 3, hour: 19, slots: 1, avgAttendance: 0, capacity: 20, fill: 0 },
        ])
    })

    it('ranks the weakest and strongest slots with enough classes', () => {
        expect(weakestSlots(slots).map((s) => s.slotId)).toEqual(['sat9'])
        expect(strongestSlots(slots).map((s) => s.slotId)).toEqual(['mon19', 'mon1930', 'sat9'])
    })

    it('suggests a class next to a full slot and rethinking a weak one', () => {
        const names = new Map([
            ['mon19', { groupName: 'BJJ вечер', gymName: 'Юпитер' }],
            ['sat9', { groupName: 'Утро', gymName: null }],
        ])
        expect(suggestOccupancyActions(slots, names)).toEqual([
            {
                kind: 'add_class',
                slotId: 'mon19',
                text: 'Пн 19:00 «BJJ вечер», Юпитер: в среднем 19 из 20 (95%). Спрос выше вместимости — добавьте занятие в соседний час или параллельную группу.',
            },
            {
                kind: 'rethink_slot',
                slotId: 'sat9',
                text: 'Сб 09:00 «Утро»: в среднем 2 из 20 (10%). Подумайте о переносе времени или объединении с другой группой.',
            },
        ])
    })

    it('labels slots with the Russian weekday', () => {
        expect(slotLabel({ dayOfWeek: 7, startTime: '10:30' })).toBe('Вс 10:30')
    })
})
