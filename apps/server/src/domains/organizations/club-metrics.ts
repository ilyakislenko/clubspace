// The headline numbers an organization sees for each ACTIVE member club
// (docs/design/2026-11-26-federation-hub-mvp.md §3.1). Every figure is a
// glossary function — the same one the club's own screens call — so the org
// console and the club dashboard can only agree. Money only where the club
// opted in, per figure.
import { averageRetention } from '../analytics/cohorts'
import { loadCohortReport } from '../analytics/analytics-reports'
import { countActiveStudentsMany } from '../metrics/active-students'
import { countStudentsAttended } from '../metrics/attendance'
import {
    computeRevenue,
    loadCurrentSales,
    loadRefunds,
    loadSales,
    paidOn,
    revenueWindowStart,
} from '../metrics/revenue'
import { countNewStudents, countStudents, type StudentScope } from '../metrics/students'
import type { PrismaService } from '../../infrastructure/prisma'

const DAY_MS = 24 * 60 * 60 * 1000
// `newcomer_retention_3m`: the 3-month cell of the club's cohort curve.
const NEWCOMER_RETENTION_OFFSET = 3

export type OrgMoney = { amount: number; currency: string | null }

export type OrgRetention = {
    // retained / eligible over the club's mature 3-month cohort cells; null
    // while no newcomer is 3 months old yet.
    rate: number | null
    eligible: number
}

export type OrgClubMetrics = {
    workspaceId: string
    // metric `students_total`
    students: number
    // metric `students_active`
    activeStudents: number
    // metric `students_attended_30d`
    attended30d: number
    // metric `new_students_30d`
    new30d: number
    // metric `newcomer_retention_3m`
    newcomerRetention3m: OrgRetention
    // metric `mrr` — null unless the club shares it (shareMrr).
    mrr: OrgMoney | null
    // metric `revenue_30d` — null unless the club shares it (shareRevenue30d).
    revenue30d: OrgMoney | null
}

export type OrgMoneyTotal = OrgMoney & {
    // «по N из M клубов»: N clubs summed (sharing, in the total's currency).
    clubs: number
}

export type OrgMetricsTotals = {
    activeClubs: number
    students: number
    activeStudents: number
    attended30d: number
    new30d: number
    // Weighted by `eligible`, like the club's own average curve.
    newcomerRetention3m: OrgRetention
    // null when no active club shares the figure.
    mrr: OrgMoneyTotal | null
    revenue30d: OrgMoneyTotal | null
}

type ActiveLink = {
    workspaceId: string
    shareMrr: boolean
    shareRevenue30d: boolean
    workspace: { id: string; ownerId: string }
}

const loadClubMetrics = async (
    prisma: PrismaService,
    link: ActiveLink,
    activeStudents: number,
    now: Date,
): Promise<OrgClubMetrics> => {
    const since30 = new Date(now.getTime() - 30 * DAY_MS)
    const scope: StudentScope = {
        workspaceId: link.workspaceId,
        ownerId: link.workspace.ownerId,
    }
    const wantsMoney = link.shareMrr || link.shareRevenue30d
    const windowStart = revenueWindowStart(now)
    const [students, attended30d, new30d, cohorts, money] = await Promise.all([
        countStudents(prisma, scope),
        countStudentsAttended(prisma, scope, since30),
        countNewStudents(prisma, scope, since30),
        // Whole club, like the club admin's unfiltered «Удержание» screen.
        loadCohortReport(prisma, {
            workspaceId: link.workspaceId,
            scope: { groupIds: null, includeGroupless: true },
            now,
        }),
        wantsMoney
            ? Promise.all([
                  loadCurrentSales(prisma, link.workspaceId, now),
                  loadSales(prisma, link.workspaceId, windowStart),
                  loadRefunds(prisma, link.workspaceId, windowStart),
              ]).then(([current, sales, refunds]) =>
                  // The dashboard's own computation (get-workspace-stats).
                  computeRevenue(
                      current,
                      sales.filter((r) => paidOn(r) >= windowStart),
                      refunds.filter((r) => r.refundedAt >= windowStart),
                  ),
              )
            : Promise.resolve(null),
    ])
    const cell = averageRetention(cohorts.cohorts).find(
        (c) => c.offset === NEWCOMER_RETENTION_OFFSET,
    )
    return {
        workspaceId: link.workspaceId,
        students,
        activeStudents,
        attended30d,
        new30d,
        newcomerRetention3m: { rate: cell?.rate ?? null, eligible: cell?.eligible ?? 0 },
        mrr:
            money && link.shareMrr
                ? { amount: money.mrr, currency: money.currency }
                : null,
        revenue30d:
            money && link.shareRevenue30d
                ? { amount: money.revenue30d, currency: money.currency }
                : null,
    }
}

// Per ACTIVE club of the org. The heaviest read of the console (the cohort
// report per club): callers go through OrgMetricsCacheService.
export const loadOrgClubMetrics = async (
    prisma: PrismaService,
    organizationId: string,
    now: Date,
): Promise<OrgClubMetrics[]> => {
    const links = await prisma.organizationClub.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: {
            workspaceId: true,
            shareMrr: true,
            shareRevenue30d: true,
            workspace: { select: { id: true, ownerId: true } },
        },
        orderBy: { invitedAt: 'asc' },
    })
    if (links.length === 0) return []
    const active = await countActiveStudentsMany(
        prisma,
        links.map((l) => l.workspace),
        now,
    )
    return Promise.all(
        links.map((l) => loadClubMetrics(prisma, l, active.get(l.workspaceId) ?? 0, now)),
    )
}

// Money over the clubs that share it. Mixed currencies are not converted: the
// total sums the most common currency and counts only those clubs.
const sumMoney = (values: OrgMoney[]): OrgMoneyTotal | null => {
    if (values.length === 0) return null
    const byCurrency = new Map<string | null, number>()
    for (const v of values) byCurrency.set(v.currency, (byCurrency.get(v.currency) ?? 0) + 1)
    const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const same = values.filter((v) => v.currency === currency)
    return {
        amount: same.reduce((s, v) => s + v.amount, 0),
        currency,
        clubs: same.length,
    }
}

// The totals row: counts summed, retention weighted by `eligible`, money over
// the opted-in clubs only. Pure.
export const summarizeOrgMetrics = (rows: readonly OrgClubMetrics[]): OrgMetricsTotals => {
    let eligible = 0
    let retained = 0
    for (const r of rows) {
        if (r.newcomerRetention3m.rate === null) continue
        eligible += r.newcomerRetention3m.eligible
        retained += r.newcomerRetention3m.rate * r.newcomerRetention3m.eligible
    }
    const sum = (pick: (r: OrgClubMetrics) => number) =>
        rows.reduce((s, r) => s + pick(r), 0)
    return {
        activeClubs: rows.length,
        students: sum((r) => r.students),
        activeStudents: sum((r) => r.activeStudents),
        attended30d: sum((r) => r.attended30d),
        new30d: sum((r) => r.new30d),
        newcomerRetention3m: {
            rate: eligible > 0 ? retained / eligible : null,
            eligible,
        },
        mrr: sumMoney(rows.flatMap((r) => (r.mrr ? [r.mrr] : []))),
        revenue30d: sumMoney(rows.flatMap((r) => (r.revenue30d ? [r.revenue30d] : []))),
    }
}
