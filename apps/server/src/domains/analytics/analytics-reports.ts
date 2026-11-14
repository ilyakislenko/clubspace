// The «Аналитика» reports, read from the snapshots and narrowed to a scope.
// Plain functions over Prisma (like load-workspace-risk.ts) so the handlers
// and the weekly digest build the same numbers.
import { localDateInTz } from '../../features/attendance/attendance-utils'
import { displayName } from '../../features/attendance/schemas'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { addDaysYmd, dbDateToYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import { churnLevel } from './churn-score'
import { type CoachStat, computeCoachStats } from './coach-stats'
import { addMonthsYmd, averageRetention, buildCohorts, type Cohort, COHORT_MONTHS } from './cohorts'
import { clubRenewalRate, FORECAST_RULES, type TrialConversion, trialConversion } from './forecast'
import {
    buildHeatmap,
    type HeatCell,
    OCCUPANCY_RULES,
    type OccupancySuggestion,
    type OccurrenceRow,
    type SlotStat,
    strongestSlots,
    suggestOccupancyActions,
    summarizeSlots,
    weakestSlots,
} from './occupancy'

// Which groups a report may look at. null = the whole club; group-less
// visits (events, personal trainings) count only with the whole club.
export type AnalyticsScope = {
    groupIds: ReadonlySet<string> | null
    includeGroupless: boolean
}

export const COACH_WINDOW_WEEKS = 12

const inScope = (scope: AnalyticsScope, groupIds: readonly string[]): boolean =>
    scope.groupIds === null || groupIds.some((g) => scope.groupIds!.has(g))

const loadRun = (prisma: PrismaService, workspaceId: string) =>
    prisma.analyticsRun.findUnique({ where: { workspaceId } })

// The visit-stat rows of a scope's groups; group-less ones only when the scope
// takes them.
const visitStatScopeWhere = (scope: AnalyticsScope): Prisma.AnalyticsMemberGroupStatWhereInput => {
    const groups = scope.groupIds
        ? { groupId: { in: [...scope.groupIds] } }
        : { groupId: { not: null } }
    if (!scope.includeGroupless) return groups
    return scope.groupIds ? { OR: [groups, { groupId: null }] } : {}
}

// ---- Cohorts ----

export type CohortReport = {
    computedAt: Date | null
    cohorts: Cohort[]
    average: { offset: number; rate: number | null; eligible: number }[]
}

export const loadCohortReport = async (
    prisma: PrismaService,
    p: { workspaceId: string; scope: AnalyticsScope; now: Date },
): Promise<CohortReport> => {
    // One visit span per member over the scope's groups, summed in SQL, and
    // only members whose first visit can fall into the cohort window: its
    // first month in any time zone is after the UTC month COHORT_MONTHS ago
    // (buildCohorts makes the exact club-local cut).
    const since = ymdToDbDate(
        addMonthsYmd(`${localDateInTz(p.now, 'UTC').slice(0, 7)}-01`, -COHORT_MONTHS),
    )
    const [run, ws, spans] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.workspace.findUniqueOrThrow({
            where: { id: p.workspaceId },
            select: { timezone: true },
        }),
        prisma.analyticsMemberGroupStat.groupBy({
            by: ['userId'],
            where: { workspaceId: p.workspaceId, ...visitStatScopeWhere(p.scope) },
            _min: { firstVisitAt: true },
            _max: { lastVisitAt: true },
            _sum: { visits: true },
            having: { firstVisitAt: { _min: { gte: since } } },
        }),
    ])
    const cohorts = buildCohorts(
        spans.map((s) => ({
            userId: s.userId,
            firstVisitAt: s._min.firstVisitAt!,
            lastVisitAt: s._max.lastVisitAt!,
            visits: s._sum.visits ?? 0,
        })),
        { now: p.now, tz: ws.timezone },
    )
    return {
        computedAt: run?.historyComputedAt ?? null,
        cohorts,
        average: averageRetention(cohorts),
    }
}

// ---- Occupancy ----

export type OccupancySlot = SlotStat & {
    groupName: string
    gymName: string | null
    directionId: string | null
}

export type OccupancyReport = {
    computedAt: Date | null
    weeks: number
    slots: OccupancySlot[]
    heatmap: { gymId: string | null; gymName: string | null; cells: HeatCell[] }[]
    weakest: OccupancySlot[]
    strongest: OccupancySlot[]
    suggestions: OccupancySuggestion[]
}

const loadOccurrences = async (
    prisma: PrismaService,
    workspaceId: string,
    scope: AnalyticsScope,
    fromYmd: string,
): Promise<OccurrenceRow[]> => {
    const rows = await prisma.analyticsSlotOccurrence.findMany({
        where: {
            workspaceId,
            sessionDate: { gte: ymdToDbDate(fromYmd) },
            ...(scope.groupIds ? { groupId: { in: [...scope.groupIds] } } : {}),
        },
    })
    return rows.map((r) => ({ ...r, sessionDate: dbDateToYmd(r.sessionDate) }))
}

export const loadOccupancyReport = async (
    prisma: PrismaService,
    p: { workspaceId: string; scope: AnalyticsScope; now: Date; weeks?: number },
): Promise<OccupancyReport> => {
    const weeks = Math.min(OCCUPANCY_RULES.maxWeeks, Math.max(1, p.weeks ?? OCCUPANCY_RULES.defaultWeeks))
    const [run, ws] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.workspace.findUniqueOrThrow({
            where: { id: p.workspaceId },
            select: { timezone: true, type: true },
        }),
    ])
    const fromYmd = addDaysYmd(localDateInTz(p.now, ws.timezone), -weeks * 7)
    const rows = await loadOccurrences(prisma, p.workspaceId, p.scope, fromYmd)
    const stats = summarizeSlots(rows, fromYmd)
    const groups = await prisma.group.findMany({
        where: { workspaceId: p.workspaceId, id: { in: [...new Set(stats.map((s) => s.groupId))] } },
        select: { id: true, name: true, directionId: true, gymId: true, gym: { select: { name: true } } },
    })
    const groupById = new Map(groups.map((g) => [g.id, g]))
    // A group deleted since the nightly rebuild drops out here.
    const slots: OccupancySlot[] = stats.flatMap((s) => {
        const g = groupById.get(s.groupId)
        return g
            ? [{ ...s, groupName: g.name, gymName: g.gym?.name ?? null, directionId: g.directionId }]
            : []
    })
    // Group/gym names per slot for the suggestion copy.
    const bySlot = new Map(slots.map((s) => [s.slotId, s]))
    const gymNames = new Map(groups.map((g) => [g.gymId, g.gym?.name ?? null]))

    return {
        computedAt: run?.historyComputedAt ?? null,
        weeks,
        slots,
        heatmap: [...buildHeatmap(slots).entries()].map(([gymId, cells]) => ({
            gymId,
            gymName: gymNames.get(gymId) ?? null,
            cells,
        })),
        weakest: weakestSlots(slots),
        strongest: strongestSlots(slots),
        suggestions: suggestOccupancyActions(slots, bySlot, vocabularyForWorkspaceType(ws.type)),
    }
}

// ---- Coaches ----

export type CoachReport = {
    computedAt: Date | null
    weeks: number
    coaches: (CoachStat & { firstname: string | null; lastname: string | null; email: string | null })[]
}

export const loadCoachReport = async (
    prisma: PrismaService,
    p: { workspaceId: string; scope: AnalyticsScope; now: Date },
): Promise<CoachReport> => {
    const [run, ws, links, stats, members, formerMembers] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.workspace.findUniqueOrThrow({
            where: { id: p.workspaceId },
            select: { timezone: true },
        }),
        prisma.groupCoach.findMany({
            where: {
                group: { workspaceId: p.workspaceId },
                ...(p.scope.groupIds ? { groupId: { in: [...p.scope.groupIds] } } : {}),
            },
            select: {
                groupId: true,
                userId: true,
                user: { select: { firstname: true, lastname: true, email: true } },
            },
        }),
        // Only the scope's groups: every coach's groups are among them.
        prisma.analyticsMemberGroupStat.findMany({
            where: {
                workspaceId: p.workspaceId,
                ...visitStatScopeWhere({ groupIds: p.scope.groupIds, includeGroupless: false }),
            },
        }),
        prisma.analyticsMemberSnapshot.findMany({
            where: { workspaceId: p.workspaceId },
            select: { userId: true, renewalsDue: true, renewalsDone: true },
        }),
        prisma.analyticsFormerMember.findMany({
            where: { workspaceId: p.workspaceId },
            select: { userId: true, renewalsDue: true, renewalsDone: true },
        }),
    ])
    // A coach's renewals count the students who have left too; one who left
    // and came back has both a snapshot and a former row.
    const renewals = new Map<string, { due: number; done: number }>()
    for (const r of [...members, ...formerMembers]) {
        const prev = renewals.get(r.userId)
        renewals.set(r.userId, {
            due: (prev?.due ?? 0) + r.renewalsDue,
            done: (prev?.done ?? 0) + r.renewalsDone,
        })
    }
    const fromYmd = addDaysYmd(localDateInTz(p.now, ws.timezone), -COACH_WINDOW_WEEKS * 7)
    const occurrences = await loadOccurrences(prisma, p.workspaceId, p.scope, fromYmd)
    // Classes a substitute ran count for the substitute, not the group's coach.
    const substitutions = await prisma.classSubstitution.findMany({
        where: {
            workspaceId: p.workspaceId,
            status: 'APPROVED',
            sessionDate: { gte: new Date(`${fromYmd}T00:00:00Z`) },
            ...(p.scope.groupIds ? { groupId: { in: [...p.scope.groupIds] } } : {}),
        },
        select: {
            slotId: true,
            sessionDate: true,
            substituteId: true,
            substitute: { select: { firstname: true, lastname: true, email: true } },
        },
    })

    const byCoach = new Map<string, { groupIds: string[]; user: (typeof links)[number]['user'] }>()
    for (const l of links) {
        const entry = byCoach.get(l.userId)
        if (entry) entry.groupIds.push(l.groupId)
        else byCoach.set(l.userId, { groupIds: [l.groupId], user: l.user })
    }
    // A coach who only substituted in scope still shows up with those classes.
    for (const s of substitutions) {
        if (!byCoach.has(s.substituteId)) {
            byCoach.set(s.substituteId, { groupIds: [], user: s.substitute })
        }
    }
    const computed = computeCoachStats({
        now: p.now,
        coaches: [...byCoach.entries()].map(([coachId, c]) => ({ coachId, groupIds: c.groupIds })),
        stats,
        renewals,
        occurrences,
        fromYmd,
        substitutes: new Map(
            substitutions.map((s) => [
                `${s.slotId}:${s.sessionDate.toISOString().slice(0, 10)}`,
                s.substituteId,
            ]),
        ),
    })
    return {
        computedAt: run?.historyComputedAt ?? null,
        weeks: COACH_WINDOW_WEEKS,
        coaches: computed
            .map((c) => ({ ...c, ...byCoach.get(c.coachId)!.user }))
            .sort(
                (a, b) =>
                    b.activeStudents - a.activeStudents ||
                    displayName(a).localeCompare(displayName(b), 'ru'),
            ),
    }
}

// ---- Forecast ----

export type ForecastReport = {
    computedAt: Date | null
    currency: string | null
    members: number
    monthlyRecurring: number
    horizons: { days: number; potential: number; expected: number; atRisk: number }[]
    renewal: {
        clubRate: number
        clubSample: number
        // Over the students in scope, those who have left included; null
        // below the minimum sample.
        scopeRate: number | null
        scopeSample: number
        usesDefault: boolean
    }
    highRiskMoney: number
    trial: TrialConversion
}

export const loadForecastReport = async (
    prisma: PrismaService,
    p: { workspaceId: string; scope: AnalyticsScope; now: Date },
): Promise<ForecastReport> => {
    const [run, rows, formerRows] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.analyticsMemberSnapshot.findMany({ where: { workspaceId: p.workspaceId } }),
        prisma.analyticsFormerMember.findMany({ where: { workspaceId: p.workspaceId } }),
    ])
    const kept = rows.filter((r) => inScope(p.scope, r.groupIds))
    const sum = (f: (r: (typeof kept)[number]) => number) => kept.reduce((s, r) => s + f(r), 0)
    // The renewal share and trial conversion also count the students of the
    // scope who have left (by the groups they attended); money and the
    // horizons are about the ones still here.
    const former = formerRows.filter((r) => inScope(p.scope, r.groupIds))
    const due = sum((r) => r.renewalsDue) + former.reduce((s, r) => s + r.renewalsDue, 0)
    const done = sum((r) => r.renewalsDone) + former.reduce((s, r) => s + r.renewalsDone, 0)
    const horizon = (days: number, potential: number, expected: number) => ({
        days,
        potential,
        expected,
        atRisk: potential - expected,
    })
    const currencies = kept.flatMap((r) => (r.currency ? [r.currency] : []))
    return {
        computedAt: run?.riskComputedAt ?? null,
        currency: currencies[0] ?? null,
        members: kept.length,
        monthlyRecurring: sum((r) => r.monthlySpend),
        horizons: [
            horizon(30, sum((r) => r.potential30), sum((r) => r.expected30)),
            horizon(90, sum((r) => r.potential90), sum((r) => r.expected90)),
        ],
        renewal: {
            clubRate: run?.clubRenewalRate ?? FORECAST_RULES.defaultRenewalRate,
            clubSample: run?.renewalSample ?? 0,
            scopeRate: clubRenewalRate(due, done).rate,
            scopeSample: due,
            usesDefault: run?.clubRenewalRate == null,
        },
        highRiskMoney: sum((r) => (churnLevel(r.score) === 'high' ? r.monthlySpend : 0)),
        trial: trialConversion(p.now, [...kept, ...former]),
    }
}
