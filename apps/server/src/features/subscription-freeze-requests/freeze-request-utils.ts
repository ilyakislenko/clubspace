import {
    addDaysYmd,
    dbDateToYmd,
    MAX_FREEZE_DAYS,
    validateFreezeWindow,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { localDateInTz } from '../attendance/attendance-utils'

// «Фамилия Имя» like everywhere in the club; never falls back to the e-mail
// (it is shown to the member), so a nameless person reads as null.
export const personName = (
    u: { firstname: string | null; lastname: string | null } | null | undefined,
): string | null => {
    if (!u) return null
    const name = [u.lastname, u.firstname]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ')
    return name || null
}

// How long a declined request stays visible to the member.
export const DECLINED_VISIBLE_DAYS = 7

export type FreezeRequestStatus =
    | 'PENDING'
    | 'APPROVED'
    | 'DECLINED'
    | 'CANCELLED'

type RequestedSubscription = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesRemaining: number | null
}

// Last day of a requested freeze (both ends inclusive).
export const requestUntilYmd = (fromYmd: string, days: number): string =>
    addDaysYmd(fromYmd, days - 1)

// The two dates formatFreezeRange expects.
export const requestRange = (r: { fromDate: Date; days: number }) => ({
    fromDate: r.fromDate,
    untilDate: ymdToDbDate(requestUntilYmd(dbDateToYmd(r.fromDate), r.days)),
})

// The last club-local day a freeze may start on: the day before endDate ends
// ("start must be before endDate").
export const lastFreezeStartYmd = (endDate: Date, tz: string): string =>
    localDateInTz(new Date(endDate.getTime() - 1), tz)

// Same rules as the coach's direct freeze, plus: a pack with nothing left has
// nothing to freeze. Returns the Russian refusal or null when the ask fits.
export const memberFreezeRefusal = (p: {
    fromYmd: string
    days: number
    now: Date
    tz: string
    subscription: RequestedSubscription
}): string | null => {
    if (p.subscription.classesRemaining === 0) {
        return 'В абонементе не осталось занятий — замораживать нечего'
    }
    return validateFreezeWindow({
        fromYmd: p.fromYmd,
        todayYmd: localDateInTz(p.now, p.tz),
        days: p.days,
        timezone: p.tz,
        now: p.now,
        subscription: p.subscription,
    })
}

export type FreezeRequestWindow = {
    today: string
    firstDate: string
    lastDate: string
    maxDays: number
}

// The start dates a member may ask for, or null when asking is not possible
// right now (open freeze, pending request, abonement not freezable).
export const freezeRequestWindow = (p: {
    now: Date
    tz: string
    subscription: RequestedSubscription
    hasOpenFreeze: boolean
    hasPending: boolean
}): FreezeRequestWindow | null => {
    if (p.hasOpenFreeze || p.hasPending) return null
    const { startDate, endDate } = p.subscription
    const today = localDateInTz(p.now, p.tz)
    if (!startDate || !endDate) return null
    const startYmd = localDateInTz(startDate, p.tz)
    const firstDate = today > startYmd ? today : startYmd
    const refusal = memberFreezeRefusal({
        fromYmd: firstDate,
        days: 1,
        now: p.now,
        tz: p.tz,
        subscription: p.subscription,
    })
    if (refusal) return null
    const lastDate = lastFreezeStartYmd(endDate, p.tz)
    if (lastDate < firstDate) return null
    return { today, firstDate, lastDate, maxDays: MAX_FREEZE_DAYS }
}

// Approving after the requested start has passed starts the freeze today
// (the service forbids past starts): the later of the two days.
export const approvalStartYmd = (reqFromYmd: string, todayYmd: string): string =>
    reqFromYmd > todayYmd ? reqFromYmd : todayYmd

// Every transition out of PENDING must go through this: the slot
// (pendingSubscriptionId) has to be freed or the member can never ask again.
export const closeRequestData = <T extends Record<string, unknown>>(
    status: Exclude<FreezeRequestStatus, 'PENDING'>,
    extra?: T,
) => ({ status, pendingSubscriptionId: null, ...extra })
