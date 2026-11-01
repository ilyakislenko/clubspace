import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import {
    scopeDirectionIds,
    subscriptionScopeIdsSelect,
} from '../subscriptions/current-subscriptions'
import { sameScope } from '../subscriptions/services/subscription.service'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'

// When an abonement bought online starts, given the member's current
// abonements of the SAME scope as the tariff (others — different directions —
// never collide with it). Checked twice: before the payment is created (so a
// member is never charged for something that cannot be granted) and again when
// the webhook confirms it (things may have changed while the member was on the
// provider's page).
//
// Mirrors SubscriptionService.grantFromPlan's refusals, from the member's side,
// for each same-scope current abonement:
// - nothing live (or it ran out of days) → starts as the tariff says (now, or
//   on the first visit);
// - a used-up class pack → starts now (the grant closes the empty pack);
// - a live class pack with classes left → refused (they would be lost);
// - a live time-only abonement → a back-to-back renewal from the club-local
//   day it ends (the latest of them);
// - one waiting for its first visit → refused (it has no end to renew from).
export type OnlineGrantStart =
    | { kind: 'now' }
    | { kind: 'renewal'; startDate: Date; fromYmd: string }
    | { kind: 'blocked'; message: string }

export type CurrentAbonement = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesTotal: number | null
    classesRemaining: number | null
}

// What onlineGrantStart needs of each current abonement (+ its scope ids).
export const onlineGrantAbonementSelect = {
    status: true,
    startDate: true,
    endDate: true,
    classesTotal: true,
    classesRemaining: true,
    ...subscriptionScopeIdsSelect,
} as const

// The member's current abonements with the same scope as a tariff.
export const sameScopeAbonements = <
    T extends { directions: ReadonlyArray<{ directionId: string }> },
>(
    current: readonly T[],
    planScope: readonly string[],
): T[] => current.filter((s) => sameScope(scopeDirectionIds(s), planScope))

export const onlineGrantStart = (
    sameScopeCurrent: readonly CurrentAbonement[],
    timezone: string,
    now: Date,
): OnlineGrantStart => {
    let renewFrom: Date | null = null
    for (const current of sameScopeCurrent) {
        if (!isSubscriptionUsable(current, now)) continue
        if (current.classesTotal !== null) {
            if ((current.classesRemaining ?? 0) <= 0) continue
            return {
                kind: 'blocked',
                message:
                    'В вашем абонементе ещё остались занятия — новый можно купить, когда они закончатся',
            }
        }
        if (current.startDate === null || current.endDate === null) {
            return {
                kind: 'blocked',
                message:
                    'Ваш абонемент начнётся с первой тренировки — продлить его можно после начала',
            }
        }
        if (!renewFrom || current.endDate > renewFrom) renewFrom = current.endDate
    }
    if (!renewFrom) return { kind: 'now' }
    const fromYmd = localDateInTz(renewFrom, timezone)
    return {
        kind: 'renewal',
        startDate: wallClockToUtc(`${fromYmd}T00:00`, timezone),
        fromYmd,
    }
}
