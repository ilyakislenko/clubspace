// Pure attendance-trend math, split out so it's unit-testable without a DB.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type WeekPoint = { week: string; checkins: number }

// Check-in counts per 7-day window for the last `weeks` windows ending at
// `now` (oldest first). Each point is labelled by its window's start date
// (YYYY-MM-DD, UTC) so the dashboard has a continuous weekly axis.
export const attendanceTrend = (
    markedAts: Date[],
    now: Date,
    weeks = 8,
): WeekPoint[] => {
    const end = now.getTime()
    const buckets = Array.from({ length: weeks }, (_, i) => {
        const start = end - (weeks - i) * WEEK_MS
        return { start, end: start + WEEK_MS, count: 0 }
    })
    for (const d of markedAts) {
        const t = d.getTime()
        for (const b of buckets) {
            if (t >= b.start && t < b.end) {
                b.count++
                break
            }
        }
    }
    return buckets.map((b) => ({
        week: new Date(b.start).toISOString().slice(0, 10),
        checkins: b.count,
    }))
}
