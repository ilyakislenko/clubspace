// The «Аналитика» reports, read from the snapshots and narrowed to a scope.
// Plain functions over Prisma (like load-workspace-risk.ts) so the handlers
// and the weekly digest build the same numbers.
import { localDateInTz } from '../../features/attendance/attendance-utils'
import { displayName } from '../../features/attendance/schemas'
import {
    type MemberGuardianOutput,
    memberGuardiansSelect,
    serializeMemberGuardians,
} from '../../features/dependents/schemas'
import type { PrismaService } from '../../infrastructure/prisma'
import { addDaysYmd, DAY_MS, dbDateToYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import {
    CHURN_REASON_CODES,
    CHURN_RULES,
    type ChurnLevel,
    churnLevel,
    type ChurnReason,
} from './churn-score'
import { type CoachStat, computeCoachStats } from './coach-stats'
import { averageRetention, buildCohorts, type Cohort, mergeVisitSpans } from './cohorts'
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

// A contact younger than this keeps a member in «Связались».
export const CONTACT_FRESH_DAYS = 14
export const CHURN_LIST_MIN_SCORE = CHURN_RULES.levels.medium
export const COACH_WINDOW_WEEKS = 12

const inScope = (scope: AnalyticsScope, groupIds: readonly string[]): boolean =>
    scope.groupIds === null || groupIds.some((g) => scope.groupIds!.has(g))

const loadRun = (prisma: PrismaService, workspaceId: string) =>
    prisma.analyticsRun.findUnique({ where: { workspaceId } })

const parseReasons = (raw: unknown): ChurnReason[] =>
    Array.isArray(raw)
        ? raw.flatMap((r) => {
              const x = r as Partial<ChurnReason>
              return typeof x.text === 'string' &&
                  typeof x.points === 'number' &&
                  (CHURN_REASON_CODES as readonly string[]).includes(x.code ?? '')
                  ? [{ code: x.code!, points: x.points, text: x.text }]
                  : []
          })
        : []

// ---- «Кому позвонить сегодня» ----

export type ChurnEntry = {
    userId: string
    firstname: string | null
    lastname: string | null
    email: string | null
    phone: string | null
    guardians: MemberGuardianOutput[]
    groups: { id: string; name: string; gymId: string | null; gymName: string | null }[]
    score: number
    level: ChurnLevel
    reasons: ChurnReason[]
    monthlySpend: number
    currency: string | null
    lastVisitAt: Date | null
    lastContact: {
        id: string
        at: Date
        byName: string
        note: string | null
        reason: string | null
        signals: string[]
    } | null
    contactedRecently: boolean
}

export type ChurnReport = {
    computedAt: Date | null
    entries: ChurnEntry[]
    summary: {
        total: number
        high: number
        medium: number
        moneyAtStake: number
        currency: string | null
        contactedRecently: number
    }
}

export const loadChurnReport = async (
    prisma: PrismaService,
    p: { workspaceId: string; scope: AnalyticsScope; now: Date; minScore?: number },
): Promise<ChurnReport> => {
    const minScore = p.minScore ?? CHURN_LIST_MIN_SCORE
    const [run, rows] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.analyticsMemberSnapshot.findMany({
            where: { workspaceId: p.workspaceId, score: { gte: Math.max(1, minScore) } },
        }),
    ])
    const kept = rows.filter((r) => inScope(p.scope, r.groupIds))
    const userIds = kept.map((r) => r.userId)
    const groupIds = [...new Set(kept.flatMap((r) => r.groupIds))]
    const [users, groups, contacts] = await Promise.all([
        prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                phone: true,
                dependentOf: memberGuardiansSelect,
            },
        }),
        prisma.group.findMany({
            where: { id: { in: groupIds }, workspaceId: p.workspaceId },
            select: { id: true, name: true, gymId: true, gym: { select: { name: true } } },
        }),
        prisma.memberRetentionContact.findMany({
            where: { workspaceId: p.workspaceId, userId: { in: userIds } },
            orderBy: { createdAt: 'desc' },
            distinct: ['userId'],
            select: {
                id: true,
                userId: true,
                createdAt: true,
                note: true,
                reason: true,
                signals: true,
                contactedBy: { select: { firstname: true, lastname: true, email: true } },
            },
        }),
    ])
    const userById = new Map(users.map((u) => [u.id, u]))
    const groupById = new Map(groups.map((g) => [g.id, g]))
    const contactByUser = new Map(contacts.map((c) => [c.userId, c]))
    const freshFrom = p.now.getTime() - CONTACT_FRESH_DAYS * DAY_MS

    const entries: ChurnEntry[] = []
    for (const r of kept) {
        const u = userById.get(r.userId)
        if (!u) continue
        const c = contactByUser.get(r.userId)
        entries.push({
            userId: r.userId,
            firstname: u.firstname,
            lastname: u.lastname,
            email: u.email,
            phone: u.phone,
            guardians: serializeMemberGuardians(u.dependentOf),
            groups: r.groupIds
                .filter((id) => p.scope.groupIds === null || p.scope.groupIds.has(id))
                .flatMap((id) => {
                    const g = groupById.get(id)
                    return g
                        ? [{ id: g.id, name: g.name, gymId: g.gymId, gymName: g.gym?.name ?? null }]
                        : []
                }),
            score: r.score,
            level: churnLevel(r.score),
            reasons: parseReasons(r.reasons),
            monthlySpend: r.monthlySpend,
            currency: r.currency,
            lastVisitAt: r.lastVisitAt,
            lastContact: c
                ? {
                      id: c.id,
                      at: c.createdAt,
                      byName: displayName(c.contactedBy),
                      note: c.note,
                      reason: c.reason,
                      signals: c.signals,
                  }
                : null,
            contactedRecently: !!c && c.createdAt.getTime() >= freshFrom,
        })
    }
    entries.sort(
        (a, b) =>
            Number(a.contactedRecently) - Number(b.contactedRecently) ||
            b.score - a.score ||
            b.monthlySpend - a.monthlySpend ||
            displayName(a).localeCompare(displayName(b), 'ru'),
    )

    const open = entries.filter((e) => !e.contactedRecently)
    return {
        computedAt: run?.riskComputedAt ?? null,
        entries,
        summary: {
            total: open.length,
            high: open.filter((e) => e.level === 'high').length,
            medium: open.filter((e) => e.level === 'medium').length,
            moneyAtStake: open.reduce((sum, e) => sum + e.monthlySpend, 0),
            currency: open.find((e) => e.currency)?.currency ?? null,
            contactedRecently: entries.length - open.length,
        },
    }
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
    const [run, ws, stats] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.workspace.findUniqueOrThrow({
            where: { id: p.workspaceId },
            select: { timezone: true },
        }),
        prisma.analyticsMemberGroupStat.findMany({ where: { workspaceId: p.workspaceId } }),
    ])
    const cohorts = buildCohorts(
        mergeVisitSpans(stats, p.scope.groupIds, p.scope.includeGroupless),
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
            select: { timezone: true },
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
        suggestions: suggestOccupancyActions(slots, bySlot),
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
    const [run, ws, links, stats, members] = await Promise.all([
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
        prisma.analyticsMemberGroupStat.findMany({
            where: { workspaceId: p.workspaceId, groupId: { not: null } },
        }),
        prisma.analyticsMemberSnapshot.findMany({
            where: { workspaceId: p.workspaceId },
            select: { userId: true, renewalsDue: true, renewalsDone: true },
        }),
    ])
    const fromYmd = addDaysYmd(localDateInTz(p.now, ws.timezone), -COACH_WINDOW_WEEKS * 7)
    const occurrences = await loadOccurrences(prisma, p.workspaceId, p.scope, fromYmd)

    const byCoach = new Map<string, { groupIds: string[]; user: (typeof links)[number]['user'] }>()
    for (const l of links) {
        const entry = byCoach.get(l.userId)
        if (entry) entry.groupIds.push(l.groupId)
        else byCoach.set(l.userId, { groupIds: [l.groupId], user: l.user })
    }
    const computed = computeCoachStats({
        now: p.now,
        coaches: [...byCoach.entries()].map(([coachId, c]) => ({ coachId, groupIds: c.groupIds })),
        stats,
        renewals: new Map(members.map((m) => [m.userId, { due: m.renewalsDue, done: m.renewalsDone }])),
        occurrences,
        fromYmd,
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
        // Over the members in scope; null below the minimum sample.
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
    const [run, rows] = await Promise.all([
        loadRun(prisma, p.workspaceId),
        prisma.analyticsMemberSnapshot.findMany({ where: { workspaceId: p.workspaceId } }),
    ])
    const kept = rows.filter((r) => inScope(p.scope, r.groupIds))
    const sum = (f: (r: (typeof kept)[number]) => number) => kept.reduce((s, r) => s + f(r), 0)
    const due = sum((r) => r.renewalsDue)
    const done = sum((r) => r.renewalsDone)
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
        trial: trialConversion(p.now, kept),
    }
}
