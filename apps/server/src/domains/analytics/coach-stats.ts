// Per-coach numbers over the groups the coach leads (primary or assistant,
// GroupCoach) inside the viewer's scope. Pure.
//  - active students: visited one of those groups in the last 30 days;
//  - 3-month retention: of the students who started there more than 90 days
//    ago and were still around 90-180 days ago (last visit within 180 days),
//    the share who also came in the last 90 days;
//  - renewals: abonements of those students that ended 14-180 days ago and
//    were renewed (forecast.ts renewalHistory);
//  - attendance per class: present marks per class the coach ran (attendance
//    taken) in the occupancy window — the classes of their groups, except
//    the ones a substitute ran, plus the ones they ran as a substitute.
import { DAY_MS } from '../subscriptions/freeze-dates'
import { type GroupVisitStat, mergeVisitSpans } from './cohorts'
import type { OccurrenceRow } from './occupancy'

export type CoachStat = {
    coachId: string
    groupIds: string[]
    activeStudents: number
    retention: { eligible: number; retained: number; rate: number | null }
    renewals: { due: number; done: number; rate: number | null }
    classes: number
    avgAttendance: number | null
}

export const computeCoachStats = (p: {
    now: Date
    coaches: ReadonlyArray<{ coachId: string; groupIds: string[] }>
    stats: ReadonlyArray<GroupVisitStat>
    renewals: ReadonlyMap<string, { due: number; done: number }>
    occurrences: ReadonlyArray<OccurrenceRow>
    fromYmd: string
    // Approved substitutions: `${slotId}:${sessionDate}` → who ran the class.
    substitutes?: ReadonlyMap<string, string>
}): CoachStat[] => {
    const now = p.now.getTime()
    const ago = (d: number) => now - d * DAY_MS
    return p.coaches.map(({ coachId, groupIds }) => {
        const groups = new Set(groupIds)
        const spans = mergeVisitSpans(p.stats, groups, false)

        let active = 0
        let eligible = 0
        let retained = 0
        let due = 0
        let done = 0
        for (const s of spans) {
            const last = s.lastVisitAt.getTime()
            if (last >= ago(30)) active += 1
            if (s.firstVisitAt.getTime() < ago(90) && last >= ago(180)) {
                eligible += 1
                if (last >= ago(90)) retained += 1
            }
            if (last >= ago(180)) {
                const r = p.renewals.get(s.userId)
                if (r) {
                    due += r.due
                    done += r.done
                }
            }
        }

        const held = p.occurrences.filter((o) => {
            if (!o.held || o.sessionDate < p.fromYmd) return false
            const substitute = p.substitutes?.get(`${o.slotId}:${o.sessionDate}`)
            return substitute ? substitute === coachId : groups.has(o.groupId)
        })
        const marks = held.reduce((sum, o) => sum + o.attended, 0)
        return {
            coachId,
            groupIds,
            activeStudents: active,
            retention: { eligible, retained, rate: eligible > 0 ? retained / eligible : null },
            renewals: { due, done, rate: due > 0 ? done / due : null },
            classes: held.length,
            avgAttendance: held.length > 0 ? Math.round((marks / held.length) * 10) / 10 : null,
        }
    })
}
