import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'

// When an abonement bought online starts, given the member's current one.
// Checked twice: before the payment is created (so a member is never charged
// for something that cannot be granted) and again when the webhook confirms it
// (things may have changed while the member was on the provider's page).
//
// Mirrors SubscriptionService.grantFromPlan's refusals, from the member's side:
// - nothing live (or it ran out of days) → starts as the tariff says (now, or
//   on the first visit);
// - a used-up class pack → starts now (the grant closes the empty pack);
// - a live class pack with classes left → refused (they would be lost);
// - a live time-only abonement → a back-to-back renewal from the club-local
//   day it ends;
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

export const onlineGrantStart = (
    current: CurrentAbonement | null,
    timezone: string,
    now: Date,
): OnlineGrantStart => {
    if (!current || !isSubscriptionUsable(current, now)) return { kind: 'now' }
    if (current.classesTotal !== null) {
        if ((current.classesRemaining ?? 0) <= 0) return { kind: 'now' }
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
    const fromYmd = localDateInTz(current.endDate, timezone)
    return {
        kind: 'renewal',
        startDate: wallClockToUtc(`${fromYmd}T00:00`, timezone),
        fromYmd,
    }
}
