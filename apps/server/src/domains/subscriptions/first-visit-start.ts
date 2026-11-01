// «Срок считается с первой тренировки»: an abonement sold on such a tariff has
// no dates until the member's first visit. Invariant: it starts on the
// club-local day of the earliest visit attributed to it; with none it is not
// started. Every mark, self-check-in, un-mark, abonement change and sale
// re-derives the start from data, so un-marking the first visit un-starts it
// or moves it to the next visit. A first visit never makes the club wait
// forever: with no (earlier) visit the abonement starts by itself
// FIRST_VISIT_AUTO_START_DAYS after the sale.
//
// A member may hold several current abonements, so each pending one is handled
// on its own. "Its" visits are the records attributed to it
// (AttendanceRecord.usedSubscriptionId, set by the visit precedence in
// visit-abonement.ts): a БЖЖ visit spent on a БЖЖ pack never starts a pending
// club-wide abonement. This replaces the old "skip visits inside the previous
// abonement's term" heuristic — a visit paid by the previous abonement is
// attributed to it and so never counts here.
// The one visit attribution can't have seen is a visit marked on the sale day
// BEFORE the sale (nothing could pay for it then): the earliest such
// unattributed visit within the abonement's scope is attributed to it here.
import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { sessionInDirectionWhere } from '../directions/direction-scope'
import type { Prisma, PrismaTransactionClientType } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    scopeDirectionIds,
    subscriptionScopeIdsSelect,
} from './current-subscriptions'
import { CHANGED_MESSAGE, DAY_MS } from './freeze-dates'

// A first-visit abonement starts at the first visit but no later than this many
// club-local days after the sale — an unused abonement must not hang forever.
export const FIRST_VISIT_AUTO_START_DAYS = 14

export type FirstVisitSync = 'started' | 'moved' | 'unstarted' | 'unchanged'

// Club-local midnight of the instant's day.
export const clubDayStart = (instant: Date, tz: string): Date =>
    wallClockToUtc(`${localDateInTz(instant, tz)}T00:00`, tz)

// The abonement's end, or — while it waits for the first visit — the
// provisional window: the latest possible start (sale-day club midnight +
// FIRST_VISIT_AUTO_START_DAYS) + the tariff's duration, so access never lapses
// before the auto-start.
export const abonementWindowEnd = (
    s: { endDate: Date | null; createdAt: Date },
    durationDays: number,
    tz: string,
): Date =>
    s.endDate ??
    new Date(
        clubDayStart(s.createdAt, tz).getTime() +
            (FIRST_VISIT_AUTO_START_DAYS + durationDays) * DAY_MS,
    )

// accessUntil follows the abonement when it tracked it, otherwise it is only
// ever extended. null is a manual "unlimited" and stays final, and so does a
// window an admin deliberately cut short (accessUntil < before).
export const followAccessUntil = (p: {
    accessUntil: Date | null
    before: Date
    after: Date
}): Date | null => {
    if (!p.accessUntil) return null
    if (p.accessUntil.getTime() < p.before.getTime()) return p.accessUntil
    if (p.accessUntil.getTime() === p.before.getTime()) return p.after
    return p.accessUntil.getTime() < p.after.getTime() ? p.after : p.accessUntil
}

type Params = { workspaceId: string; userId: string; now: Date }

type PendingSub = {
    id: string
    startDate: Date | null
    endDate: Date | null
    createdAt: Date
    durationDays: number | null
    classesTotal: number | null
    classesRemaining: number | null
    plan: { durationDays: number }
    directions: Array<{ directionId: string }>
}

type MemberState = { id: string; accessUntil: Date | null; tz: string }

// The member with every current, never-frozen «с первой тренировки»
// abonement (a freeze already moved endDate — the start is locked once one
// exists; an expired one is never moved or revived).
const loadMember = (tx: PrismaTransactionClientType, p: Params) =>
    tx.workspaceMember.findFirst({
        where: { workspaceId: p.workspaceId, userId: p.userId },
        select: {
            id: true,
            accessUntil: true,
            workspace: { select: { timezone: true } },
            subscriptions: {
                where: {
                    ...currentSubscriptionWhere(p.now),
                    startsOnFirstVisit: true,
                    freezes: { none: {} },
                },
                orderBy: currentSubscriptionOrderBy,
                select: {
                    id: true,
                    startDate: true,
                    endDate: true,
                    createdAt: true,
                    durationDays: true,
                    classesTotal: true,
                    classesRemaining: true,
                    plan: { select: { durationDays: true } },
                    ...subscriptionScopeIdsSelect,
                },
            },
        },
    })

const visitSelect = {
    id: true,
    consumedSubscriptionId: true,
    session: { select: { startAt: true } },
} as const

const syncOne = async (
    tx: PrismaTransactionClientType,
    p: Params,
    member: MemberState,
    sub: PendingSub,
): Promise<FirstVisitSync | 'retry'> => {
    const tz = member.tz
    const duration = sub.durationDays ?? sub.plan.durationDays
    const saleStart = clubDayStart(sub.createdAt, tz)

    // The earliest visit attributed to this abonement…
    let visit = await tx.attendanceRecord.findFirst({
        where: {
            workspaceId: p.workspaceId,
            userId: p.userId,
            usedSubscriptionId: sub.id,
        },
        orderBy: { session: { startAt: 'asc' } },
        select: visitSelect,
    })
    // …or a sale-day visit marked before the sale, of a class its scope covers
    // (empty scope = every class).
    let unattributed = false
    if (!visit) {
        const scope = scopeDirectionIds(sub)
        const inScope: Prisma.AttendanceSessionWhereInput =
            scope.length === 0 ? {} : { OR: scope.map(sessionInDirectionWhere) }
        visit = await tx.attendanceRecord.findFirst({
            where: {
                workspaceId: p.workspaceId,
                userId: p.userId,
                usedSubscriptionId: null,
                markedAt: { lte: sub.createdAt },
                session: { startAt: { gte: saleStart }, ...inScope },
            },
            orderBy: { session: { startAt: 'asc' } },
            select: visitSelect,
        })
        unattributed = visit !== null
    }

    // No visit (or only a later one) by the deadline: it starts on its own.
    const autoStart = new Date(
        saleStart.getTime() + FIRST_VISIT_AUTO_START_DAYS * DAY_MS,
    )
    const visitStart = visit ? clubDayStart(visit.session.startAt, tz) : null
    const byVisit =
        visitStart !== null &&
        !(p.now.getTime() >= autoStart.getTime() && visitStart > autoStart)
    const startDate = byVisit
        ? visitStart
        : p.now.getTime() >= autoStart.getTime()
          ? autoStart
          : null
    const endDate = startDate
        ? new Date(startDate.getTime() + duration * DAY_MS)
        : null
    const datesChanged =
        startDate?.getTime() !== sub.startDate?.getTime() ||
        endDate?.getTime() !== sub.endDate?.getTime()

    if (datesChanged) {
        // Compare-and-set so a racing mark/un-mark can't both win.
        const res = await tx.subscription.updateMany({
            where: {
                id: sub.id,
                status: 'ACTIVE',
                startDate: sub.startDate,
                endDate: sub.endDate,
                freezes: { none: {} },
            },
            data: { startDate, endDate },
        })
        if (res.count !== 1) return 'retry'
    }

    // The pre-sale visit that starts it becomes its visit. The first training
    // of a pack counts as the first of its classes: that visit deducted
    // nothing, so take its class now (un-marking refunds through
    // consumedSubscriptionId).
    if (byVisit && unattributed && visit) {
        let consumed = false
        if (
            !visit.consumedSubscriptionId &&
            sub.classesTotal != null &&
            (sub.classesRemaining ?? 0) > 0
        ) {
            const took = await tx.subscription.updateMany({
                where: { id: sub.id, classesRemaining: { gt: 0 } },
                data: { classesRemaining: { decrement: 1 } },
            })
            consumed = took.count === 1
        }
        await tx.attendanceRecord.update({
            where: { id: visit.id },
            data: consumed
                ? { usedSubscriptionId: sub.id, consumedSubscriptionId: sub.id }
                : { usedSubscriptionId: sub.id },
        })
    }

    if (!datesChanged) return 'unchanged'

    const next = followAccessUntil({
        accessUntil: member.accessUntil,
        before: abonementWindowEnd(sub, duration, tz),
        after: abonementWindowEnd({ endDate, createdAt: sub.createdAt }, duration, tz),
    })
    if (next?.getTime() !== member.accessUntil?.getTime()) {
        await tx.workspaceMember.update({
            where: { id: member.id },
            data: { accessUntil: next },
        })
        member.accessUntil = next
        // The access window moved for a reason of its own: an old freeze that
        // had shifted it must not, when released, cut it again.
        await tx.subscriptionFreeze.updateMany({
            where: {
                workspaceId: p.workspaceId,
                userId: p.userId,
                accessShifted: true,
            },
            data: { accessShifted: false },
        })
    }

    if (!startDate) return 'unstarted'
    return sub.startDate ? 'moved' : 'started'
}

// Most significant first: what the caller gets when several abonements of one
// member changed in one sync.
const SIGNIFICANCE: readonly FirstVisitSync[] = [
    'started',
    'moved',
    'unstarted',
    'unchanged',
]

const attempt = async (
    tx: PrismaTransactionClientType,
    p: Params,
): Promise<FirstVisitSync | 'retry'> => {
    const member = await loadMember(tx, p)
    if (!member || member.subscriptions.length === 0) return 'unchanged'
    const state: MemberState = {
        id: member.id,
        accessUntil: member.accessUntil,
        tz: member.workspace.timezone,
    }
    // Narrowest scope first (stable otherwise), so a pre-sale visit is claimed
    // by the abonement the precedence would have spent it on — club-wide last.
    const rank = (s: PendingSub) =>
        s.directions.length === 0 ? Number.POSITIVE_INFINITY : s.directions.length
    const subs = [...member.subscriptions].sort((a, b) =>
        rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1,
    )
    let best: FirstVisitSync = 'unchanged'
    for (const sub of subs) {
        const res = await syncOne(tx, p, state, sub)
        if (res === 'retry') return 'retry'
        if (SIGNIFICANCE.indexOf(res) < SIGNIFICANCE.indexOf(best)) best = res
    }
    return best
}

// Re-derives the start of every pending «с первой тренировки» abonement of the
// member. Idempotent; a lost compare-and-set re-runs the whole pass once.
export const syncFirstVisitStartInTx = async (
    tx: PrismaTransactionClientType,
    p: { workspaceId: string; userId: string; now?: Date },
): Promise<FirstVisitSync> => {
    const args = { ...p, now: p.now ?? new Date() }
    for (let i = 0; i < 2; i++) {
        const res = await attempt(tx, args)
        if (res !== 'retry') return res
    }
    throw new BadRequestError({ message: CHANGED_MESSAGE })
}
