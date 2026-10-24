// «Срок считается с первой тренировки»: an abonement sold on such a tariff has
// no dates until the member's first visit. Invariant: it starts on the
// club-local day of the earliest qualifying visit; with none it is not started.
// Every mark, self-check-in, un-mark and sale re-derives the start from data,
// so un-marking the first visit un-starts it or moves it to the next visit.
import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { DAY_MS } from './freeze-dates'
import { CHANGED_MESSAGE } from './services/subscription-freeze.service'

export type FirstVisitSync = 'started' | 'moved' | 'unstarted' | 'unchanged'

// Club-local midnight of the instant's day.
export const clubDayStart = (instant: Date, tz: string): Date =>
    wallClockToUtc(`${localDateInTz(instant, tz)}T00:00`, tz)

// The abonement's end, or — while it waits for the first visit — the
// provisional window: sale-day club midnight + the tariff's duration.
export const abonementWindowEnd = (
    s: { endDate: Date | null; createdAt: Date },
    durationDays: number,
    tz: string,
): Date =>
    s.endDate ??
    new Date(clubDayStart(s.createdAt, tz).getTime() + durationDays * DAY_MS)

// accessUntil follows the abonement when it tracked it, otherwise it is only
// ever extended. null is a manual "unlimited" and stays final.
export const followAccessUntil = (p: {
    accessUntil: Date | null
    before: Date
    after: Date
}): Date | null => {
    if (!p.accessUntil) return null
    if (p.accessUntil.getTime() === p.before.getTime()) return p.after
    if (p.accessUntil.getTime() < p.after.getTime()) return p.after
    return p.accessUntil
}

const loadMember = (
    tx: PrismaTransactionClientType,
    p: { workspaceId: string; userId: string },
) =>
    tx.workspaceMember.findFirst({
        where: { workspaceId: p.workspaceId, userId: p.userId },
        select: {
            id: true,
            accessUntil: true,
            workspace: { select: { timezone: true } },
            subscription: {
                select: {
                    id: true,
                    status: true,
                    startsOnFirstVisit: true,
                    durationDays: true,
                    startDate: true,
                    endDate: true,
                    createdAt: true,
                    plan: { select: { durationDays: true } },
                    _count: { select: { freezes: true } },
                },
            },
        },
    })

const attempt = async (
    tx: PrismaTransactionClientType,
    p: { workspaceId: string; userId: string; now: Date },
): Promise<FirstVisitSync | 'retry'> => {
    const member = await loadMember(tx, p)
    const sub = member?.subscription
    if (!member || !sub) return 'unchanged'
    if (sub.status !== 'ACTIVE' || !sub.startsOnFirstVisit) return 'unchanged'
    // A freeze already moved endDate — the start is locked once one exists.
    if (sub._count.freezes > 0) return 'unchanged'
    // Never move or revive an expired abonement.
    if (sub.endDate && sub.endDate.getTime() <= p.now.getTime()) {
        return 'unchanged'
    }

    const tz = member.workspace.timezone
    const duration = sub.durationDays ?? sub.plan.durationDays
    const saleStart = clubDayStart(sub.createdAt, tz)

    const visit = await tx.attendanceRecord.findFirst({
        where: {
            workspaceId: p.workspaceId,
            userId: p.userId,
            session: { startAt: { gte: saleStart } },
            OR: [
                { consumedSubscriptionId: null },
                { consumedSubscriptionId: sub.id },
            ],
        },
        orderBy: { session: { startAt: 'asc' } },
        select: { session: { select: { startAt: true } } },
    })

    const startDate = visit ? clubDayStart(visit.session.startAt, tz) : null
    const endDate = startDate
        ? new Date(startDate.getTime() + duration * DAY_MS)
        : null
    if (
        startDate?.getTime() === sub.startDate?.getTime() &&
        endDate?.getTime() === sub.endDate?.getTime()
    ) {
        return 'unchanged'
    }

    // Compare-and-set so a racing mark/un-mark can't both win.
    const res = await tx.subscription.updateMany({
        where: { id: sub.id, status: 'ACTIVE', startDate: sub.startDate },
        data: { startDate, endDate },
    })
    if (res.count !== 1) return 'retry'

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
