import type { Prisma, PrismaTransactionClientType } from '../../infrastructure/prisma'
import {
    heldSubscriptionWhere,
    subscriptionScopeIdsSelect,
} from '../subscriptions/current-subscriptions'
import { RENEWAL_LAPSED_DAYS } from '../subscriptions/renewal-rules'
import {
    type AutopayDueKind,
    autopayNextChargeOn,
    pickAnchor,
} from './autopay-rules'

const DAY_MS = 24 * 60 * 60 * 1000

// What the rules read of each of the member's abonements: the dates, the pack
// balance, the scope, and the last deducting check-in (the pack's 1 h guard).
export const autopayAbonementSelect = {
    id: true,
    status: true,
    startDate: true,
    endDate: true,
    classesTotal: true,
    classesRemaining: true,
    durationDays: true,
    createdAt: true,
    updatedAt: true,
    ...subscriptionScopeIdsSelect,
    consumedRecords: {
        orderBy: { markedAt: 'desc' },
        take: 1,
        select: { markedAt: true },
    },
    burnedBookings: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { updatedAt: true },
    },
} as const satisfies Prisma.SubscriptionSelect

export type AutopayAbonementRow = Prisma.SubscriptionGetPayload<{
    select: typeof autopayAbonementSelect
}>

// The member's held abonements the rules judge (any status — a cancelled one
// tells «the club cancelled it»): open-ended, or ended within
// RENEWAL_LAPSED_DAYS.
export const loadAutopayAbonements = (
    db: Pick<PrismaTransactionClientType, 'subscription'>,
    p: { workspaceMemberId: string; now: Date },
): Promise<AutopayAbonementRow[]> =>
    db.subscription.findMany({
        where: {
            ...heldSubscriptionWhere,
            workspaceMemberId: p.workspaceMemberId,
            OR: [
                { endDate: null },
                { endDate: { gt: new Date(p.now.getTime() - RENEWAL_LAPSED_DAYS * DAY_MS) } },
            ],
        },
        select: autopayAbonementSelect,
    })

// When the pack's last class went: the later of its last deducting check-in
// and its last class burned by a late cancel / no-show (the booking's write
// that took it); the row's last write when it has neither.
export const lastUsedAt = (anchor: AutopayAbonementRow): Date => {
    const checkIn = anchor.consumedRecords[0]?.markedAt
    const burn = anchor.burnedBookings[0]?.updatedAt
    if (checkIn && burn) return checkIn > burn ? checkIn : burn
    return checkIn ?? burn ?? anchor.updatedAt
}

// The anchor of an agreement and its next charge day (for the member's and
// staff's «следующее списание»), from the member's abonements.
export const autopaySchedule = (
    subs: readonly AutopayAbonementRow[],
    planScope: readonly string[],
    tz: string,
    now: Date,
): {
    anchor: AutopayAbonementRow | null
    nextCharge: { on: string; kind: AutopayDueKind } | null
} => {
    const anchor = pickAnchor(subs, planScope, now)
    return {
        anchor,
        nextCharge: anchor ? autopayNextChargeOn(anchor, tz, lastUsedAt(anchor)) : null,
    }
}
