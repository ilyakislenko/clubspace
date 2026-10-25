import {
    isoDayOfWeek,
    localMinuteInTz,
} from '../../features/attendance/attendance-utils'
import { ymdToDbDate } from '../subscriptions/freeze-dates'
import type { WorkspaceRiskEntry } from './load-workspace-risk'
import { RISK_REASONS, type RiskReason } from './risk-signals'

// Monday, 10:00-10:59 club time. The tick runs every minute, so the service
// claims the day in NotificationDispatchLog to run once.
export const retentionDigestSlot = (
    now: Date,
    tz: string,
): { due: boolean; localYmd: string } => {
    const local = localMinuteInTz(now, tz)
    const localYmd = local.slice(0, 10)
    // The club-local date, never `now`: the UTC day can differ from it.
    const due =
        isoDayOfWeek(ymdToDbDate(localYmd)) === 1 &&
        Number(local.slice(11, 13)) === 10
    return { due, localYmd }
}

export type CoachDigestCount = {
    total: number
    byReason: Record<RiskReason, number>
}

// Non-snoozed at-risk members per coach, over the groups the coach leads
// (primary or assistant: the GroupCoach junction).
export const coachDigestCounts = (
    entries: WorkspaceRiskEntry[],
    coachRows: { userId: string; groupId: string }[],
): Map<string, CoachDigestCount> => {
    const groupsByCoach = new Map<string, Set<string>>()
    for (const r of coachRows) {
        const set = groupsByCoach.get(r.userId)
        if (set) set.add(r.groupId)
        else groupsByCoach.set(r.userId, new Set([r.groupId]))
    }

    const out = new Map<string, CoachDigestCount>()
    for (const [coachId, groupIds] of groupsByCoach) {
        const byReason = Object.fromEntries(
            RISK_REASONS.map((r) => [r, 0]),
        ) as Record<RiskReason, number>
        let total = 0
        for (const e of entries) {
            if (e.snoozed || !e.groups.some((g) => groupIds.has(g.id))) continue
            total += 1
            byReason[e.risk.reason] += 1
        }
        out.set(coachId, { total, byReason })
    }
    return out
}
