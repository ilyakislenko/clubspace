// «Срок считается с первой тренировки»: an abonement sold on such a tariff has
// no dates until the member's first visit. Invariant: it starts on the
// club-local day of the earliest qualifying visit; with none it is not started.
// Every mark, self-check-in, un-mark and sale re-derives the start from data,
// so un-marking the first visit un-starts it or moves it to the next visit.
// A first visit never makes the club wait forever: with no (earlier) visit the
// abonement starts by itself FIRST_VISIT_AUTO_START_DAYS after the sale.
import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { DAY_MS } from './freeze-dates'
import { CHANGED_MESSAGE } from './services/subscription-freeze.service'

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
                    classesTotal: true,
                    classesRemaining: true,
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

    // The abonement this sale replaced: visits inside its term belong to it.
    const previous = await tx.subscription.findFirst({
        where: {
            workspaceMemberId: member.id,
            id: { not: sub.id },
            // A cancelled / used-up pack keeps its old endDate but no longer
            // owns any days.
            status: 'ACTIVE',
            endDate: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { endDate: true },
    })
    const earliest =
        previous?.endDate && previous.endDate.getTime() > saleStart.getTime()
            ? previous.endDate
            : saleStart

    const visit = await tx.attendanceRecord.findFirst({
        where: {
            workspaceId: p.workspaceId,
            userId: p.userId,
            session: { startAt: { gte: earliest } },
            OR: [
                { consumedSubscriptionId: null },
                { consumedSubscriptionId: sub.id },
            ],
        },
        orderBy: { session: { startAt: 'asc' } },
        select: {
            id: true,
            consumedSubscriptionId: true,
            session: { select: { startAt: true } },
        },
    })

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
    if (
        startDate?.getTime() === sub.startDate?.getTime() &&
        endDate?.getTime() === sub.endDate?.getTime()
    ) {
        return 'unchanged'
    }

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

    // The first training of a pack counts as the first of its classes: a visit
    // marked before the sale deducted nothing, so take its class now.
    if (
        byVisit &&
        visit &&
        !visit.consumedSubscriptionId &&
        sub.classesTotal != null &&
        (sub.classesRemaining ?? 0) > 0
    ) {
        const took = await tx.subscription.updateMany({
            where: { id: sub.id, classesRemaining: { gt: 0 } },
            data: { classesRemaining: { decrement: 1 } },
        })
        if (took.count === 1) {
            // Un-marking this visit refunds through consumedSubscriptionId.
            await tx.attendanceRecord.update({
                where: { id: visit.id },
                data: { consumedSubscriptionId: sub.id },
            })
        }
    }

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
