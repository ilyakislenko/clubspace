// Which of a member's abonements a visit is spent on — the visit precedence
// (docs/design/2026-11-01-directions.md, «Несколько абонементов»). Coach
// marking, self check-in and their previews all go through here.
//
// Eligible for a class of direction D (or of no direction, D = null):
//   - current (ACTIVE, endDate not passed) and already started (startDate null
//     = waits for its first visit, which this one may be; a dated renewal that
//     starts later is not eligible yet),
//   - not frozen on the class day,
//   - its scope covers the class: club-wide always; a scoped one only when D is
//     in its scope (a class without a direction draws club-wide ones only),
//   - a class pack with classes left, or a time-based one (classesTotal null).
//     An exhausted pack is skipped so the next matching one pays.
// Order (first = used by default):
//   1. narrowest scope: a scope containing D (fewest directions first) before
//      club-wide,
//   2. the one ending soonest (open-ended / not started yet last),
//   3. the older sale, then id (deterministic).
// A class pack is decremented; a time-based abonement counts the visit without
// deducting. No eligible abonement = the visit is recorded unattributed, as
// before (training past an exhausted pack is never refused).
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { directionRefSelect, type DirectionRef } from '../directions/direction-ref'
import {
    currentSubscriptionWhere,
    scopeCoversDirection,
} from './current-subscriptions'
import { ymdToDbDate } from './freeze-dates'

export type VisitAbonementCandidate = {
    id: string
    status: string
    startDate: Date | null
    endDate: Date | null
    createdAt: Date
    classesTotal: number | null
    classesRemaining: number | null
    startsOnFirstVisit: boolean
    // Scope snapshot; empty = club-wide.
    directionIds: readonly string[]
    // Frozen on the class day.
    frozen: boolean
}

const scopeRank = (scope: readonly string[]): number =>
    scope.length === 0 ? Number.POSITIVE_INFINITY : scope.length

export const isEligibleForVisit = (
    s: VisitAbonementCandidate,
    p: { sessionDirectionId: string | null; now: Date },
): boolean => {
    if (s.status !== 'ACTIVE') return false
    if (s.endDate && s.endDate.getTime() <= p.now.getTime()) return false
    if (s.startDate && s.startDate.getTime() > p.now.getTime()) return false
    if (s.frozen) return false
    if (!scopeCoversDirection(s.directionIds, p.sessionDirectionId)) return false
    if (s.classesTotal !== null && (s.classesRemaining ?? 0) <= 0) return false
    return true
}

export const compareVisitPrecedence = (
    a: VisitAbonementCandidate,
    b: VisitAbonementCandidate,
): number => {
    const aScope = scopeRank(a.directionIds)
    const bScope = scopeRank(b.directionIds)
    if (aScope !== bScope) return aScope < bScope ? -1 : 1
    const aEnd = a.endDate?.getTime() ?? Number.POSITIVE_INFINITY
    const bEnd = b.endDate?.getTime() ?? Number.POSITIVE_INFINITY
    if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1
    const created = a.createdAt.getTime() - b.createdAt.getTime()
    if (created !== 0) return created
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Every abonement this visit may be spent on, in precedence order (first = the
// default; the coach / member may pick any other one of the list).
export const rankVisitAbonements = <T extends VisitAbonementCandidate>(
    subs: readonly T[],
    p: { sessionDirectionId: string | null; now: Date },
): T[] =>
    subs.filter((s) => isEligibleForVisit(s, p)).sort(compareVisitPrecedence)

export const pickVisitAbonement = <T extends VisitAbonementCandidate>(
    subs: readonly T[],
    p: { sessionDirectionId: string | null; now: Date },
): T | null => rankVisitAbonements(subs, p)[0] ?? null

// What clients show for an abonement a visit is (or would be) spent on.
export type VisitAbonement = {
    subscriptionId: string
    planName: string
    classesTotal: number | null
    classesRemaining: number | null
    endDate: string | null
    directions: DirectionRef[]
}

export type LoadedVisitCandidate = VisitAbonementCandidate & {
    userId: string
    planName: string
    directions: DirectionRef[]
}

export const toVisitAbonement = (c: LoadedVisitCandidate): VisitAbonement => ({
    subscriptionId: c.id,
    planName: c.planName,
    classesTotal: c.classesTotal,
    classesRemaining: c.classesRemaining,
    endDate: c.endDate ? c.endDate.toISOString() : null,
    directions: c.directions,
})

// Current abonements of these members with everything the precedence needs.
// `dayYmd` = the class's club-local day (freezes are club-local days).
export const loadVisitCandidates = async (
    db: Pick<PrismaTransactionClientType, 'subscription'>,
    p: { workspaceId: string; userIds: readonly string[]; dayYmd: string; now: Date },
): Promise<Map<string, LoadedVisitCandidate[]>> => {
    const byUser = new Map<string, LoadedVisitCandidate[]>()
    if (p.userIds.length === 0) return byUser
    const day = ymdToDbDate(p.dayYmd)
    const rows = await db.subscription.findMany({
        where: {
            workspaceId: p.workspaceId,
            workspaceMember: { userId: { in: [...p.userIds] } },
            ...currentSubscriptionWhere(p.now),
        },
        select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            createdAt: true,
            classesTotal: true,
            classesRemaining: true,
            startsOnFirstVisit: true,
            plan: { select: { name: true } },
            workspaceMember: { select: { userId: true } },
            directions: {
                select: { directionId: true, direction: directionRefSelect },
                orderBy: [
                    { direction: { order: 'asc' } },
                    { direction: { name: 'asc' } },
                ],
            },
            freezes: {
                where: { fromDate: { lte: day }, untilDate: { gte: day } },
                select: { id: true },
                take: 1,
            },
        },
    })
    for (const r of rows) {
        const userId = r.workspaceMember?.userId
        if (!userId) continue
        const list = byUser.get(userId) ?? []
        list.push({
            id: r.id,
            userId,
            status: r.status,
            startDate: r.startDate,
            endDate: r.endDate,
            createdAt: r.createdAt,
            classesTotal: r.classesTotal,
            classesRemaining: r.classesRemaining,
            startsOnFirstVisit: r.startsOnFirstVisit,
            planName: r.plan.name,
            directionIds: r.directions.map((d) => d.directionId),
            directions: r.directions.map((d) => d.direction),
            frozen: r.freezes.length > 0,
        })
        byUser.set(userId, list)
    }
    return byUser
}
