import { computeCoachStats } from './coach-stats'
import type { OccurrenceRow } from './occupancy'

const DAY = 24 * 3600_000
const NOW = new Date('2026-11-02T05:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

const stat = (userId: string, groupId: string, first: number, last: number) => ({
    userId,
    groupId,
    firstVisitAt: ago(first),
    lastVisitAt: ago(last),
    visits: 5,
})

const occ = (groupId: string, attended: number, held = true): OccurrenceRow => ({
    groupId,
    slotId: `slot-${groupId}`,
    gymId: null,
    sessionDate: '2026-10-20',
    dayOfWeek: 2,
    startTime: '19:00',
    held,
    attended,
    roster: 20,
    capacity: null,
    booked: 0,
    missedBookings: 0,
})

describe('computeCoachStats', () => {
    it('reports zeros and nulls for a coach without history', () => {
        expect(
            computeCoachStats({
                now: NOW,
                coaches: [{ coachId: 'c', groupIds: ['g'] }],
                stats: [],
                renewals: new Map(),
                occurrences: [],
                fromYmd: '2026-08-01',
            }),
        ).toEqual([
            {
                coachId: 'c',
                groupIds: ['g'],
                activeStudents: 0,
                retention: { eligible: 0, retained: 0, rate: null },
                renewals: { due: 0, done: 0, rate: null },
                classes: 0,
                avgAttendance: null,
            },
        ])
    })

    it('counts students, 3-month retention, renewals and attendance over the coach’s groups', () => {
        const [a, b] = computeCoachStats({
            now: NOW,
            coaches: [
                { coachId: 'a', groupIds: ['g1'] },
                { coachId: 'b', groupIds: ['g2'] },
            ],
            stats: [
                stat('stays', 'g1', 200, 3), // eligible, retained, active
                stat('left', 'g1', 150, 120), // eligible, gone
                stat('long-gone', 'g1', 400, 300), // outside the 180-day window
                stat('new', 'g1', 20, 2), // too new to judge, active
                stat('other', 'g2', 200, 100),
            ],
            renewals: new Map([
                ['stays', { due: 3, done: 3 }],
                ['left', { due: 2, done: 0 }],
                ['long-gone', { due: 4, done: 0 }],
            ]),
            occurrences: [occ('g1', 10), occ('g1', 14), occ('g1', 0, false), occ('g2', 4)],
            fromYmd: '2026-08-01',
        })
        expect(a).toMatchObject({
            activeStudents: 2,
            retention: { eligible: 2, retained: 1, rate: 0.5 },
            renewals: { due: 5, done: 3, rate: 0.6 },
            classes: 2,
            avgAttendance: 12,
        })
        expect(b).toMatchObject({
            activeStudents: 0,
            retention: { eligible: 1, retained: 0, rate: 0 },
            classes: 1,
            avgAttendance: 4,
        })
    })
})
