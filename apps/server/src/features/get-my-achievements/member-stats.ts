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

// «Стаж» of a member: first training (club-local date), full calendar months
// since then and the average number of trainings per month.
export const memberStats = (input: {
    visitStarts: Date[]
    completedSubscriptions: number
    now: Date
    timezone: string
}): MemberStats => {
    const { visitStarts, completedSubscriptions, now, timezone } = input
    if (visitStarts.length === 0) {
        return {
            firstTrainingDate: null,
            monthsTraining: 0,
            avgPerMonth: 0,
            completedSubscriptions,
        }
    }
    const first = new Date(Math.min(...visitStarts.map((d) => d.getTime())))
    const a = localParts(first, timezone)
    const b = localParts(now, timezone)
    const months = Math.max(
        0,
        (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0),
    )
    return {
        firstTrainingDate: `${a.y}-${pad(a.m)}-${pad(a.d)}`,
        monthsTraining: months,
        avgPerMonth:
            Math.round((visitStarts.length / Math.max(1, months)) * 10) / 10,
        completedSubscriptions,
    }
}
