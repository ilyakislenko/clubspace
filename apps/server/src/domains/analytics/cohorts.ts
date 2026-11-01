// Cohort retention: students grouped by the club-local month of their first
// visit, and the share still training 1/2/3/6 months later. Pure.
//
// "Still active at k months" = the member's last visit is on or after the
// club-local date of the first visit plus k calendar months (31 Jan + 1 month
// = 28/29 Feb). A cell counts only the members whose k-month date has already
// come (`eligible`); a cohort too young for a cell shows null, a partly grown
// one is flagged `partial`.
import { localDateInTz } from '../../features/attendance/attendance-utils'

export const COHORT_OFFSETS = [1, 2, 3, 6] as const
export const COHORT_MONTHS = 12

export type MemberVisitSpan = {
    userId: string
    firstVisitAt: Date
    lastVisitAt: Date
    visits: number
}

export type GroupVisitStat = MemberVisitSpan & { groupId: string | null }

export type CohortCell = {
    offset: number
    eligible: number
    retained: number
    // retained / eligible, 0..1; null while no member reached the offset.
    rate: number | null
    partial: boolean
}

export type Cohort = {
    month: string // YYYY-MM, club-local
    size: number
    cells: CohortCell[]
}

const daysInMonth = (y: number, m: number): number =>
    new Date(Date.UTC(y, m, 0)).getUTCDate()

// 'YYYY-MM-DD' + k calendar months, clamped to the last day of the month.
export const addMonthsYmd = (ymd: string, k: number): string => {
    const [y, m, d] = ymd.split('-').map(Number)
    const total = y * 12 + (m - 1) + k
    const ty = Math.floor(total / 12)
    const tm = (total % 12) + 1
    const td = Math.min(d, daysInMonth(ty, tm))
    return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`
}

// Collapses per-group visit stats to one span per member over the groups
// `allowed` names (null = every group); group-less visits (events, personal)
// count only when `includeGroupless`.
export const mergeVisitSpans = (
    stats: ReadonlyArray<GroupVisitStat>,
    allowed: ReadonlySet<string> | null,
    includeGroupless: boolean,
): MemberVisitSpan[] => {
    const byUser = new Map<string, MemberVisitSpan>()
    for (const s of stats) {
        if (s.groupId === null ? !includeGroupless : allowed && !allowed.has(s.groupId)) {
            continue
        }
        const prev = byUser.get(s.userId)
        if (!prev) {
            byUser.set(s.userId, {
                userId: s.userId,
                firstVisitAt: s.firstVisitAt,
                lastVisitAt: s.lastVisitAt,
                visits: s.visits,
            })
            continue
        }
        if (s.firstVisitAt < prev.firstVisitAt) prev.firstVisitAt = s.firstVisitAt
        if (s.lastVisitAt > prev.lastVisitAt) prev.lastVisitAt = s.lastVisitAt
        prev.visits += s.visits
    }
    return [...byUser.values()]
}

export const buildCohorts = (
    spans: ReadonlyArray<MemberVisitSpan>,
    p: { now: Date; tz: string; months?: number },
): Cohort[] => {
    const todayYmd = localDateInTz(p.now, p.tz)
    const oldest = addMonthsYmd(`${todayYmd.slice(0, 7)}-01`, -((p.months ?? COHORT_MONTHS) - 1))
    const byMonth = new Map<string, { first: string; last: string }[]>()
    for (const s of spans) {
        const first = localDateInTz(s.firstVisitAt, p.tz)
        if (first < oldest) continue
        const month = first.slice(0, 7)
        const entry = { first, last: localDateInTz(s.lastVisitAt, p.tz) }
        const list = byMonth.get(month)
        if (list) list.push(entry)
        else byMonth.set(month, [entry])
    }

    return [...byMonth.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, members]) => ({
            month,
            size: members.length,
            cells: COHORT_OFFSETS.map((offset) => {
                let eligible = 0
                let retained = 0
                for (const m of members) {
                    const due = addMonthsYmd(m.first, offset)
                    if (due > todayYmd) continue
                    eligible += 1
                    if (m.last >= due) retained += 1
                }
                return {
                    offset,
                    eligible,
                    retained,
                    rate: eligible > 0 ? retained / eligible : null,
                    partial: eligible > 0 && eligible < members.length,
                }
            }),
        }))
}

// The weighted average of every mature cell per offset: the curve the screen
// draws over the cohorts.
export const averageRetention = (
    cohorts: ReadonlyArray<Cohort>,
): { offset: number; rate: number | null; eligible: number }[] =>
    COHORT_OFFSETS.map((offset) => {
        let eligible = 0
        let retained = 0
        for (const c of cohorts) {
            const cell = c.cells.find((x) => x.offset === offset)
            if (!cell) continue
            eligible += cell.eligible
            retained += cell.retained
        }
        return { offset, rate: eligible > 0 ? retained / eligible : null, eligible }
    })
