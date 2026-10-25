// Reminders for an abonement that is running but not marked as paid. They nudge
// the member to settle with the coach — and the coach's own list («ожидают
// оплаты») is the real follow-up, so this stays short and polite.
import {
    localDateInTz,
    localMinuteInTz,
} from '../../features/attendance/attendance-utils'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { formatPhone } from '../../shared/utils/phone'
import { diffDaysYmd } from './freeze-dates'
import type { MemberCoach } from './member-coach'

// First reminder the day after the start, then every 3rd day, at most 4 in all
// (start+1, +4, +7, +10).
export const PAYMENT_REMINDER_FIRST_AFTER_DAYS = 1
export const PAYMENT_REMINDER_EVERY_DAYS = 3
export const PAYMENT_REMINDER_MAX = 4

// Club-local hours in which a reminder may go out, [from, to).
export const PAYMENT_REMINDER_HOURS = [10, 21] as const

const MAX_VISITS_LISTED = 6

// Which reminder (0-based) is due on `todayYmd` for an abonement that started on
// `startYmd` (both club-local days), or null when none is.
export const paymentReminderIndex = (
    startYmd: string,
    todayYmd: string,
): number | null => {
    const d = diffDaysYmd(todayYmd, startYmd)
    if (d < PAYMENT_REMINDER_FIRST_AFTER_DAYS) return null
    const k = Math.floor(
        (d - PAYMENT_REMINDER_FIRST_AFTER_DAYS) / PAYMENT_REMINDER_EVERY_DAYS,
    )
    return k < PAYMENT_REMINDER_MAX ? k : null
}

export const isReminderHour = (now: Date, tz: string): boolean => {
    const hour = Number(localMinuteInTz(now, tz).slice(11, 13))
    return hour >= PAYMENT_REMINDER_HOURS[0] && hour < PAYMENT_REMINDER_HOURS[1]
}

const visitLabel = (visit: Date, tz: string): string => {
    const [, month, day] = localDateInTz(visit, tz).split('-')
    return `${day}.${month}`
}

export const paymentReminderText = (p: {
    planName: string
    startDate: Date
    timezone: string
    coach: Pick<MemberCoach, 'name' | 'phone'> | null
    visits: Date[]
}): string => {
    const parts = [
        `«${p.planName}»: абонемент начался ${formatRuDate(p.startDate, p.timezone)}, но оплата пока не отмечена.`,
    ]
    if (p.coach?.name) {
        const phone = p.coach.phone ? `, ${formatPhone(p.coach.phone)}` : ''
        parts.push(`Тренер группы: ${p.coach.name}${phone}.`)
    }
    if (p.visits.length > 0) {
        const shown = p.visits
            .slice(0, MAX_VISITS_LISTED)
            .map((v) => visitLabel(v, p.timezone))
        const more = p.visits.length - shown.length
        parts.push(
            `Визиты по абонементу: ${shown.join(', ')}${more > 0 ? ` и ещё ${more}` : ''}.`,
        )
    }
    parts.push('Если вы уже оплатили, напомните тренеру отметить оплату.')
    return parts.join(' ')
}
