jest.mock('./load-workspace-risk')

import { loadCallList, narrowCallList, summarizeCallList } from './call-list'
import { loadWorkspaceRisk, type WorkspaceRiskEntry } from './load-workspace-risk'
import type { RiskReason } from './risk-signals'

const NOW = new Date('2026-11-14T08:00:00.000Z')
const RUN_AT = new Date('2026-11-14T07:00:00.000Z')

const risk = (
    userId: string,
    reason: RiskReason,
    over: Partial<WorkspaceRiskEntry> & { daysSinceLastVisit?: number | null } = {},
): WorkspaceRiskEntry => {
    const { daysSinceLastVisit = 10, ...rest } = over
    return {
        userId,
        firstname: userId,
        lastname: null,
        email: null,
        phone: null,
        guardians: [],
        groups: [{ id: 'g1', name: 'Вечер', gymId: null, gymName: null }],
        risk: {
            reason,
            signals: [reason],
            facts: {
                lastVisitAt: new Date('2026-11-04T10:00:00.000Z'),
                daysSinceLastVisit,
                firstVisitAt: null,
                daysSinceFirstVisit: null,
                visitsLast14d: 1,
                recentPerWeek: 0.5,
                baselinePerWeek: 2,
                absentSinceFreeze: false,
                lapseKind: null,
                lapsedAt: null,
                planName: null,
            },
        },
        factsText: 'текст',
        lastContact: null,
        snoozed: false,
        ...rest,
    }
}

const makePrisma = (snapshots: { userId: string; score: number; monthlySpend: number; currency: string | null }[]) => ({
    analyticsRun: { findUnique: jest.fn().mockResolvedValue({ riskComputedAt: RUN_AT }) },
    analyticsMemberSnapshot: { findMany: jest.fn().mockResolvedValue(snapshots) },
})

describe('loadCallList', () => {
    it('takes who and why from the live engine and joins the score by userId', async () => {
        ;(loadWorkspaceRisk as jest.Mock).mockResolvedValue([
            risk('a', 'absent'),
            risk('b', 'lapsed', {
                lastContact: {
                    id: 'c1',
                    at: new Date('2026-11-13T09:00:00.000Z'),
                    byName: 'Ольга',
                    note: null,
                    reason: 'lapsed',
                    signals: ['lapsed'],
                },
                snoozed: true,
            }),
            risk('fresh', 'newcomer'),
        ])
        const prisma = makePrisma([
            { userId: 'a', score: 72, monthlySpend: 4000, currency: 'RUB' },
            { userId: 'b', score: 20, monthlySpend: 3000, currency: 'RUB' },
            // Not flagged by the live rules: not on the list.
            { userId: 'gone', score: 95, monthlySpend: 9000, currency: 'RUB' },
        ])

        const list = await loadCallList(prisma as never, { workspaceId: 'w1', now: NOW })

        expect(loadWorkspaceRisk).toHaveBeenCalledWith(prisma, { workspaceId: 'w1', now: NOW })
        expect(prisma.analyticsMemberSnapshot.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['a', 'b', 'fresh'] },
        })
        expect(list.scoredAt).toBe(RUN_AT.toISOString())
        expect(list.entries.map((e) => [e.userId, e.score, e.level, e.monthlySpend])).toEqual([
            ['b', 20, 'low', 3000],
            // No snapshot yet: still listed, unscored.
            ['fresh', null, null, null],
            ['a', 72, 'high', 4000],
        ])
        // JSON-safe for the cache.
        expect(list.entries[0].lastContact?.at).toBe('2026-11-13T09:00:00.000Z')
        expect(list.entries[0].facts.lastVisitAt).toBe('2026-11-04T10:00:00.000Z')
        expect(JSON.parse(JSON.stringify(list))).toEqual(list)
    })

    it('orders by reason, then score, then the longest absence, then the name', async () => {
        ;(loadWorkspaceRisk as jest.Mock).mockResolvedValue([
            risk('Вера', 'absent', { daysSinceLastVisit: 20 }),
            risk('Борис', 'absent', { daysSinceLastVisit: 40 }),
            risk('Анна', 'absent', { daysSinceLastVisit: 20 }),
            risk('Глеб', 'absent', { daysSinceLastVisit: 5 }),
            risk('Дина', 'declining'),
        ])
        const prisma = makePrisma([{ userId: 'Глеб', score: 60, monthlySpend: 0, currency: null }])
        const list = await loadCallList(prisma as never, { workspaceId: 'w1', now: NOW })
        expect(list.entries.map((e) => e.userId)).toEqual(['Глеб', 'Борис', 'Анна', 'Вера', 'Дина'])
    })

    it('has no score time before the first snapshot', async () => {
        ;(loadWorkspaceRisk as jest.Mock).mockResolvedValue([])
        const prisma = makePrisma([])
        prisma.analyticsRun.findUnique.mockResolvedValue(null)
        const list = await loadCallList(prisma as never, { workspaceId: 'w1', now: NOW })
        expect(list).toEqual({ scoredAt: null, entries: [] })
    })
})

describe('narrowCallList and summarizeCallList', () => {
    const entries = async () => {
        ;(loadWorkspaceRisk as jest.Mock).mockResolvedValue([
            risk('a', 'lapsed', {
                groups: [
                    { id: 'g1', name: 'Вечер', gymId: null, gymName: null },
                    { id: 'g2', name: 'Утро', gymId: null, gymName: null },
                ],
            }),
            risk('b', 'absent', { groups: [{ id: 'g2', name: 'Утро', gymId: null, gymName: null }] }),
            risk('c', 'absent', { groups: [], snoozed: true }),
        ])
        const prisma = makePrisma([
            { userId: 'a', score: 70, monthlySpend: 5000, currency: 'RUB' },
            { userId: 'c', score: 70, monthlySpend: 7000, currency: 'RUB' },
        ])
        return (await loadCallList(prisma as never, { workspaceId: 'w1', now: NOW })).entries
    }

    it('keeps the whole club for null and narrows rows and their groups otherwise', async () => {
        const all = await entries()
        expect(narrowCallList(all, null)).toBe(all)
        const g1 = narrowCallList(all, new Set(['g1']))
        expect(g1.map((e) => [e.userId, e.groups.map((g) => g.id)])).toEqual([['a', ['g1']]])
    })

    it('counts the ones to call per reason; snoozed only in snoozed, money of the open ones', async () => {
        expect(summarizeCallList(await entries())).toEqual({
            total: 2,
            lapsed: 1,
            newcomer: 0,
            absent: 1,
            declining: 0,
            high: 1,
            snoozed: 1,
            moneyAtStake: 5000,
            currency: 'RUB',
        })
    })
})
