// Pure date maths for abonement freezes ("заморозка"). A freeze is two inclusive
// club-local calendar days stored as `@db.Date` (UTC midnight); everything here
// works on 'YYYY-MM-DD' strings so no timezone can leak into the arithmetic.
import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { formatRuDate } from '../../shared/utils/format-ru-date'

export const DAY_MS = 24 * 60 * 60 * 1000

export type FreezeDates = { fromDate: Date; untilDate: Date }

export type FreezePhase = 'upcoming' | 'current' | 'past'

export const ymdToDbDate = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`)

export const dbDateToYmd = (d: Date): string => d.toISOString().slice(0, 10)

export const addDaysYmd = (ymd: string, n: number): string =>
    dbDateToYmd(new Date(ymdToDbDate(ymd).getTime() + n * DAY_MS))

export const diffDaysYmd = (later: string, earlier: string): number =>
    Math.round(
        (ymdToDbDate(later).getTime() - ymdToDbDate(earlier).getTime()) / DAY_MS,
    )

export const freezeDays = (f: FreezeDates): number =>
    diffDaysYmd(dbDateToYmd(f.untilDate), dbDateToYmd(f.fromDate)) + 1

export const freezePhase = (f: FreezeDates, todayYmd: string): FreezePhase => {
    if (todayYmd < dbDateToYmd(f.fromDate)) return 'upcoming'
    if (todayYmd > dbDateToYmd(f.untilDate)) return 'past'
    return 'current'
}

// "с 24 по 30 октября" within a month, "с 28 октября по 3 ноября" across months.
export const formatFreezeRange = (f: FreezeDates): string => {
    const sameMonth =
        f.fromDate.getUTCFullYear() === f.untilDate.getUTCFullYear() &&
        f.fromDate.getUTCMonth() === f.untilDate.getUTCMonth()
    const from = sameMonth
        ? String(f.fromDate.getUTCDate())
        : formatRuDate(f.fromDate, 'UTC')
    return `с ${from} по ${formatRuDate(f.untilDate, 'UTC')}`
}

export type FreezeEndPlan =
    // Not started yet (or starts today): the row goes away, every day comes back.
    | { kind: 'remove'; returnDays: number }
    // Running: untilDate becomes yesterday, the unused days come back.
    | { kind: 'shrink'; returnDays: number; untilYmd: string }
    | { kind: 'finished' }

export const planFreezeEnd = (
    f: FreezeDates,
    todayYmd: string,
): FreezeEndPlan => {
    const fromYmd = dbDateToYmd(f.fromDate)
    const untilYmd = dbDateToYmd(f.untilDate)
    if (todayYmd <= fromYmd) return { kind: 'remove', returnDays: freezeDays(f) }
    if (todayYmd > untilYmd) return { kind: 'finished' }
    return {
        kind: 'shrink',
        returnDays: diffDaysYmd(untilYmd, todayYmd) + 1,
        untilYmd: addDaysYmd(todayYmd, -1),
    }
}

export const MAX_FREEZE_DAYS = 90

// Returns the first matching Russian refusal message, or null when the freeze fits.
export const validateFreezeWindow = (p: {
    fromYmd: string
    todayYmd: string
    days: number
    timezone: string
    now: Date
    subscription: { status: string; startDate: Date; endDate: Date | null }
}): string | null => {
    const { subscription: sub, timezone: tz } = p
    if (sub.status === 'CANCELLED') {
        return 'Абонемент отменён — заморозить его нельзя'
    }
    if (sub.status !== 'ACTIVE') {
        return 'Заморозить можно только действующий абонемент'
    }
    if (!sub.endDate) {
        return 'У абонемента нет срока действия — замораживать нечего'
    }
    if (sub.endDate.getTime() <= p.now.getTime()) {
        return 'Абонемент уже закончился — заморозить можно только действующий'
    }
    if (
        !Number.isInteger(p.days) ||
        p.days < 1 ||
        p.days > MAX_FREEZE_DAYS
    ) {
        return `Заморозка — от 1 до ${MAX_FREEZE_DAYS} дней`
    }
    if (p.fromYmd < p.todayYmd) {
        return 'Дата начала заморозки не может быть в прошлом'
    }
    if (p.fromYmd < localDateInTz(sub.startDate, tz)) {
        return `Абонемент начинается ${formatRuDate(sub.startDate, tz)} — заморозка не может начаться раньше`
    }
    if (
        wallClockToUtc(`${p.fromYmd}T00:00`, tz).getTime() >=
        sub.endDate.getTime()
    ) {
        return `Абонемент действует до ${formatRuDate(sub.endDate, tz)} — заморозка должна начаться раньше`
    }
    return null
}
