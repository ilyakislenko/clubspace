// «Кому позвонить»: the one call list behind the admin page, the dashboard
// tile, the mobile home card and the mobile list
// (docs/design/2026-11-08-admin-cleanup.md B1). Who is on it and why comes
// from the live rule engine (a member whose abonement ended this morning is
// on it today); the churn score and «₽ на кону» are joined from the hourly
// snapshot by userId (no snapshot row → no score, still listed).
//
// JSON-safe on purpose (dates as ISO strings): the whole club's list is
// cached in Redis for a minute (call-list-cache.service.ts).
import { displayName } from '../../features/attendance/schemas'
import type { MemberGuardianOutput } from '../../features/dependents/schemas'
import type { PrismaService } from '../../infrastructure/prisma'
import { type ChurnLevel, churnLevel } from '../analytics/churn-score'
import { loadWorkspaceRisk } from './load-workspace-risk'
import {
    type LapseKind,
    RISK_REASONS,
    type RiskReason,
} from './risk-signals'

export type CallListGroup = {
    id: string
    name: string
    gymId: string | null
    gymName: string | null
}

export type CallListEntry = {
    userId: string
    firstname: string | null
    lastname: string | null
    email: string | null
    phone: string | null
    guardians: MemberGuardianOutput[]
    groups: CallListGroup[]
    reason: RiskReason
    signals: RiskReason[]
    factsText: string
    facts: {
        lastVisitAt: string | null
        daysSinceLastVisit: number | null
        firstVisitAt: string | null
        visitsLast14d: number
        recentPerWeek: number
        baselinePerWeek: number
        lapseKind: LapseKind | null
        lapsedAt: string | null
        planName: string | null
    }
    lastContact: {
        id: string
        at: string
        byName: string
        note: string | null
        reason: RiskReason | null
        signals: RiskReason[]
    } | null
    // A «Связались» that still covers every current signal: off the list.
    snoozed: boolean
    // From the snapshot; null when the member has none yet.
    score: number | null
    level: ChurnLevel | null
    // Average monthly spend (club money — callers strip it below club admin).
    monthlySpend: number | null
    currency: string | null
}

export type CallList = {
    // When the snapshot behind the scores was computed (null = never).
    scoredAt: string | null
    entries: CallListEntry[]
}

const iso = (d: Date | null): string | null => d?.toISOString() ?? null

// Lapsed first (it is a renewal waiting to happen), then the riskiest by
// score, then the longest absent; the name keeps the order stable.
const compare = (a: CallListEntry, b: CallListEntry): number => {
    const byReason = RISK_REASONS.indexOf(a.reason) - RISK_REASONS.indexOf(b.reason)
    if (byReason !== 0) return byReason
    if (a.score !== b.score) return (b.score ?? -1) - (a.score ?? -1)
    const da = a.facts.daysSinceLastVisit
    const db = b.facts.daysSinceLastVisit
    if (da !== db) {
        if (da == null) return 1
        if (db == null) return -1
        return db - da
    }
    return displayName(a).localeCompare(displayName(b), 'ru')
}

export const loadCallList = async (
    prisma: PrismaService,
    p: { workspaceId: string; now: Date },
): Promise<CallList> => {
    const risk = await loadWorkspaceRisk(prisma, p)
    const [run, snapshots] = await Promise.all([
        prisma.analyticsRun.findUnique({
            where: { workspaceId: p.workspaceId },
            select: { riskComputedAt: true },
        }),
        prisma.analyticsMemberSnapshot.findMany({
            where: {
                workspaceId: p.workspaceId,
                userId: { in: risk.map((e) => e.userId) },
            },
            select: { userId: true, score: true, monthlySpend: true, currency: true },
        }),
    ])
    const snapshotByUser = new Map(snapshots.map((s) => [s.userId, s]))

    const entries = risk.map((e): CallListEntry => {
        const s = snapshotByUser.get(e.userId)
        return {
            userId: e.userId,
            firstname: e.firstname,
            lastname: e.lastname,
            email: e.email,
            phone: e.phone,
            guardians: e.guardians,
            groups: e.groups,
            reason: e.risk.reason,
            signals: e.risk.signals,
            factsText: e.factsText,
            facts: {
                lastVisitAt: iso(e.risk.facts.lastVisitAt),
                daysSinceLastVisit: e.risk.facts.daysSinceLastVisit,
                firstVisitAt: iso(e.risk.facts.firstVisitAt),
                visitsLast14d: e.risk.facts.visitsLast14d,
                recentPerWeek: e.risk.facts.recentPerWeek,
                baselinePerWeek: e.risk.facts.baselinePerWeek,
                lapseKind: e.risk.facts.lapseKind,
                lapsedAt: iso(e.risk.facts.lapsedAt),
                planName: e.risk.facts.planName,
            },
            lastContact: e.lastContact
                ? { ...e.lastContact, at: e.lastContact.at.toISOString() }
                : null,
            snoozed: e.snoozed,
            score: s ? s.score : null,
            level: s ? churnLevel(s.score) : null,
            monthlySpend: s ? s.monthlySpend : null,
            currency: s?.currency ?? null,
        }
    })

    return { scoredAt: iso(run?.riskComputedAt ?? null), entries: entries.sort(compare) }
}

// Only the groups a caller may look at (null = the whole club): an entry with
// none of them left is outside the caller's scope.
export const narrowCallList = (
    entries: CallListEntry[],
    groupIds: ReadonlySet<string> | null,
): CallListEntry[] => {
    if (groupIds === null) return entries
    return entries.flatMap((e) => {
        const groups = e.groups.filter((g) => groupIds.has(g.id))
        return groups.length > 0 ? [{ ...e, groups }] : []
    })
}

export type CallListSummary = {
    // Still to call (not snoozed), in total and per reason.
    total: number
    lapsed: number
    newcomer: number
    absent: number
    declining: number
    // Of those, a high churn score.
    high: number
    // Contacted and still covered by the contact.
    snoozed: number
    // Monthly spend of everyone still to call.
    moneyAtStake: number
    currency: string | null
}

export const summarizeCallList = (entries: CallListEntry[]): CallListSummary => {
    const out: CallListSummary = {
        total: 0,
        lapsed: 0,
        newcomer: 0,
        absent: 0,
        declining: 0,
        high: 0,
        snoozed: 0,
        moneyAtStake: 0,
        currency: null,
    }
    for (const e of entries) {
        if (e.snoozed) {
            out.snoozed += 1
            continue
        }
        out.total += 1
        out[e.reason] += 1
        if (e.level === 'high') out.high += 1
        out.moneyAtStake += e.monthlySpend ?? 0
        out.currency ??= e.currency
    }
    return out
}
