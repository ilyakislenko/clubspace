import { attendanceTrend } from './attendance-trend'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const now = new Date('2026-07-23T12:00:00Z')

describe('attendanceTrend', () => {
    it('emits one point per week, oldest first, all zero with no data', () => {
        const out = attendanceTrend([], now, 8)
        expect(out).toHaveLength(8)
        expect(out.every((p) => p.checkins === 0)).toBe(true)
        // Oldest bucket starts 8 weeks before now; each labelled by its start.
        expect(out[7].week).toBe(
            new Date(now.getTime() - WEEK_MS).toISOString().slice(0, 10),
        )
    })

    it('counts check-ins into the right weekly bucket', () => {
        const thisWeek = new Date(now.getTime() - 2 * 24 * 3600 * 1000) // 2 days ago
        const lastWeek = new Date(now.getTime() - 9 * 24 * 3600 * 1000) // 9 days ago
        const out = attendanceTrend(
            [thisWeek, thisWeek, lastWeek],
            now,
            8,
        )
        expect(out[7].checkins).toBe(2) // current 7-day window
        expect(out[6].checkins).toBe(1) // previous window
        expect(out[0].checkins).toBe(0)
    })

    it('ignores check-ins outside the window', () => {
        const old = new Date(now.getTime() - 60 * 24 * 3600 * 1000) // ~8.5 weeks ago
        const out = attendanceTrend([old], now, 8)
        expect(out.reduce((s, p) => s + p.checkins, 0)).toBe(0)
    })
})
