// metric `expected_revenue_30d` / `expected_revenue_90d` («Ожидается за 30 /
// 90 дней»): renewals of the current students' abonements expected inside the
// horizon — each renewal's price × the student's renewal probability (the
// club's renewal share scaled down by their churn score, domains/analytics/
// forecast.ts) — summed from the hourly analytics snapshot. «Если все продлят»
// is the same sum at probability 1. The dashboard tile and «Прогноз выручки»
// both sum here.
import type { PrismaService } from '../../infrastructure/prisma'

export type ExpectedRevenueRow = {
    potential30: number
    expected30: number
    potential90: number
    expected90: number
}

export type RevenueHorizon = {
    days: 30 | 90
    potential: number
    expected: number
    atRisk: number
}

export const expectedRevenue = (
    rows: ReadonlyArray<ExpectedRevenueRow>,
): [RevenueHorizon, RevenueHorizon] => {
    const sum = (f: (r: ExpectedRevenueRow) => number) => rows.reduce((s, r) => s + f(r), 0)
    const horizon = (days: 30 | 90, potential: number, expected: number): RevenueHorizon => ({
        days,
        potential,
        expected,
        atRisk: potential - expected,
    })
    return [
        horizon(30, sum((r) => r.potential30), sum((r) => r.expected30)),
        horizon(90, sum((r) => r.potential90), sum((r) => r.expected90)),
    ]
}

// The whole club (the dashboard).
export const loadExpectedRevenue = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<[RevenueHorizon, RevenueHorizon]> =>
    expectedRevenue(
        await prisma.analyticsMemberSnapshot.findMany({
            where: { workspaceId },
            select: { potential30: true, expected30: true, potential90: true, expected90: true },
        }),
    )
