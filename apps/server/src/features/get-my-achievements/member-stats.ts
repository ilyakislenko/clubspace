import { TZDate } from '@date-fns/tz'

export interface MemberStats {
    firstTrainingDate: string | null
    monthsTraining: number
    avgPerMonth: number
    completedSubscriptions: number
}

const pad = (n: number) => String(n).padStart(2, '0')

const localParts = (d: Date, timezone: string) => {
    const t = new TZDate(d, timezone)
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }
}

const MONTH_MS = 30.4375 * 86_400_000

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// «Стаж» of a member: first training (date in that session's own timezone),
// full calendar months since then and the average number of trainings per
// elapsed month.
export const memberStats = (input: {
    visits: { startAt: Date; timezone: string }[]
    completedSubscriptions: number
    now: Date
}): MemberStats => {
    const { visits, completedSubscriptions, now } = input
    if (visits.length === 0) {
        return {
            firstTrainingDate: null,
            monthsTraining: 0,
            avgPerMonth: 0,
            completedSubscriptions,
        }
    }
    const first = visits.reduce((min, v) => (v.startAt < min.startAt ? v : min))
    const a = localParts(first.startAt, first.timezone)
    const b = localParts(now, first.timezone)
    const months = Math.max(
        0,
        (b.y - a.y) * 12 +
            (b.m - a.m) -
            (b.d < Math.min(a.d, daysIn(b.y, b.m)) ? 1 : 0),
    )
    const elapsedMonths = (now.getTime() - first.startAt.getTime()) / MONTH_MS
    return {
        firstTrainingDate: `${a.y}-${pad(a.m)}-${pad(a.d)}`,
        monthsTraining: months,
        avgPerMonth:
            Math.round((visits.length / Math.max(1, elapsedMonths)) * 10) / 10,
        completedSubscriptions,
    }
}
