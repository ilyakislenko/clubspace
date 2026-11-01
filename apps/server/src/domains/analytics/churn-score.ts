// «Кому позвонить сегодня»: a 0-100 churn risk score per student, built from
// explainable signals with fixed points (docs/design/2026-11-01-smart-analytics.md
// — the table there is this file). Pure: the snapshot service gathers the
// facts, this adds the points and words the reasons. No ML, no hidden weights:
// every point on the screen comes with a Russian sentence saying why.
import { localDateInTz } from '../../features/attendance/attendance-utils'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { pluralRu } from '../../shared/utils/plural-ru'
import { DAY_MS, diffDaysYmd } from '../subscriptions/freeze-dates'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'
import { formatMoney } from './money'

export const CHURN_RULES = {
    // Visits the trend compares: the last `recentDays` against the weeks
    // before them inside `windowDays` (8 + 4 weeks).
    windowDays: 84,
    recentDays: 28,
    // The trend needs at least this many baseline visits (1 a week).
    minBaselineVisits: 8,
    // A trend drop below this share is noise.
    minTrendDrop: 0.3,
    trendMaxPoints: 20,
    // Days since the last visit (or the end of a freeze) → points.
    absence: [
        { days: 45, points: 40 },
        { days: 30, points: 32 },
        { days: 21, points: 24 },
        { days: 14, points: 16 },
    ],
    // Shorter gaps still count when they are twice the member's usual gap.
    shortGapPoints: 8,
    shortGapMinDays: 7,
    neverVisitedPoints: 20,
    neverVisitedAfterDays: 7,
    afterFreezePoints: 10,
    expiredPoints: 25,
    expiredWindowDays: 30,
    outOfClassesPoints: 20,
    endingSoon: [
        { days: 7, points: 15 },
        { days: 14, points: 8 },
    ],
    missedBookingPoints: 6,
    missedBookingMaxPoints: 18,
    missedBookingWindowDays: 30,
    newcomerPoints: 12,
    newcomerMaxDays: 60,
    newcomerMinDays: 14,
    newcomerWindowDays: 14,
    newcomerMinVisits: 2,
    debtPoints: 10,
    debtAfterDays: 7,
    // Loyalty: a year in the club takes points off (never below 0).
    veteranDays: 365,
    veteranPoints: -10,
    frozenPoints: 5,
    // Coaches stopped marking attendance: the attendance signals are off.
    activityGuardDays: 14,
    levels: { high: 60, medium: 35 },
} as const

export const CHURN_REASON_CODES = [
    'absent',
    'never_visited',
    'after_freeze',
    'declining',
    'expired',
    'out_of_classes',
    'ending_soon',
    'missed_bookings',
    'newcomer',
    'debt',
    'frozen',
    'veteran',
] as const
export type ChurnReasonCode = (typeof CHURN_REASON_CODES)[number]

export type ChurnReason = {
    code: ChurnReasonCode
    points: number
    text: string
}

export type ChurnLevel = 'high' | 'medium' | 'low'

export type ChurnSubscription = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesRemaining: number | null
    planName: string
    isTrial: boolean
    isPaid: boolean
    amountPaid: number
    currency: string
    createdAt: Date
}

export type ChurnInput = {
    now: Date
    // Club timezone: days count club-local calendar days.
    tz: string
    // The club marked any attendance in the last `activityGuardDays`.
    attendanceActive: boolean
    // WorkspaceMember.createdAt: tenure of someone who never came.
    joinedAt: Date
    firstVisitAt: Date | null
    lastVisitAt: Date | null
    // Visits inside `windowDays`.
    windowVisits: Date[]
    // Every current abonement frozen now (or about to be): the last frozen day.
    frozenUntil: Date | null
    // Club-local midnight after the newest finished freeze.
    lastFreezeEndAt: Date | null
    subscriptions: ChurnSubscription[]
    // Drop-in bookings in the last 30 days the member did not come to.
    missedBookings: number
}

export type ChurnResult = {
    score: number
    level: ChurnLevel
    // Every reason that fired, strongest first (the veteran bonus last).
    reasons: ChurnReason[]
}

const daysBetween = (later: Date, earlier: Date, tz: string): number =>
    diffDaysYmd(localDateInTz(later, tz), localDateInTz(earlier, tz))

const rate = (x: number): string =>
    String(Math.round(x * 10) / 10).replace('.', ',')

const days = (n: number): string => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`

export const churnLevel = (score: number): ChurnLevel =>
    score >= CHURN_RULES.levels.high
        ? 'high'
        : score >= CHURN_RULES.levels.medium
          ? 'medium'
          : 'low'

const abonementReasons = (i: ChurnInput): ChurnReason[] => {
    const { now, tz } = i
    const paidSubs = i.subscriptions.filter((s) => !s.isTrial)
    const current = paidSubs.filter((s) => isSubscriptionUsable(s, now))
    if (current.length === 0) {
        // The abonement that ended last; a cancelled one never "lapsed".
        const latest = paidSubs
            .filter(
                (s) =>
                    s.status !== 'CANCELLED' &&
                    s.endDate !== null &&
                    s.endDate.getTime() <= now.getTime(),
            )
            .sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime())[0]
        if (
            latest &&
            now.getTime() - latest.endDate!.getTime() <=
                CHURN_RULES.expiredWindowDays * DAY_MS
        ) {
            return [
                {
                    code: 'expired',
                    points: CHURN_RULES.expiredPoints,
                    text: `Абонемент «${latest.planName}» закончился ${formatRuDate(latest.endDate!, tz)} и не продлён`,
                },
            ]
        }
        return []
    }

    // A pack with 0 classes left is current but not live.
    const live = current.filter((s) => s.classesRemaining !== 0)
    if (live.length === 0) {
        const empty = current[0]
        return [
            {
                code: 'out_of_classes',
                points: CHURN_RULES.outOfClassesPoints,
                text: `Закончились занятия в абонементе «${empty.planName}»`,
            },
        ]
    }
    // A next abonement already bought (waits for its first visit) or one
    // without an end date keeps the member covered.
    if (live.some((s) => s.endDate === null)) return []
    const last = live.sort(
        (a, b) => b.endDate!.getTime() - a.endDate!.getTime(),
    )[0]
    const left = daysBetween(last.endDate!, now, tz)
    for (const step of CHURN_RULES.endingSoon) {
        if (left <= step.days) {
            return [
                {
                    code: 'ending_soon',
                    points: step.points,
                    text: `Абонемент «${last.planName}» заканчивается через ${days(Math.max(0, left))}, следующий не куплен`,
                },
            ]
        }
    }
    return []
}

const debtReason = (i: ChurnInput): ChurnReason | null => {
    const unpaid = i.subscriptions.filter(
        (s) =>
            !s.isPaid &&
            s.amountPaid > 0 &&
            (s.status === 'ACTIVE' || s.status === 'EXPIRED') &&
            i.now.getTime() - s.createdAt.getTime() >=
                CHURN_RULES.debtAfterDays * DAY_MS,
    )
    if (unpaid.length === 0) return null
    const amount = unpaid.reduce((sum, s) => sum + s.amountPaid, 0)
    return {
        code: 'debt',
        points: CHURN_RULES.debtPoints,
        text: `Долг ${formatMoney(amount, unpaid[0].currency)} за «${unpaid[0].planName}»`,
    }
}

export const computeChurnScore = (i: ChurnInput): ChurnResult => {
    const { now, tz } = i
    const reasons: ChurnReason[] = []
    const since = (d: number): number => now.getTime() - d * DAY_MS

    reasons.push(...abonementReasons(i))
    const debt = debtReason(i)
    if (debt) reasons.push(debt)

    if (i.frozenUntil) {
        // Away on purpose: the attendance signals are off until it ends.
        reasons.push({
            code: 'frozen',
            points: CHURN_RULES.frozenPoints,
            text: `Абонемент заморожен до ${formatRuDate(i.frozenUntil, 'UTC')}`,
        })
    } else if (i.attendanceActive) {
        const freezeEnd = i.lastFreezeEndAt
        const recent = i.windowVisits.filter(
            (v) => v.getTime() >= since(CHURN_RULES.recentDays),
        ).length
        const baseline = i.windowVisits.length - recent
        const baselinePerWeek =
            baseline / ((CHURN_RULES.windowDays - CHURN_RULES.recentDays) / 7)
        const recentPerWeek = recent / (CHURN_RULES.recentDays / 7)

        if (i.lastVisitAt) {
            const afterFreeze =
                freezeEnd !== null && freezeEnd.getTime() > i.lastVisitAt.getTime()
            const anchor = afterFreeze ? freezeEnd! : i.lastVisitAt
            const gap = daysBetween(now, anchor, tz)
            const usualGap = baselinePerWeek >= 0.5 ? 7 / baselinePerWeek : 7
            const step = CHURN_RULES.absence.find((s) => gap >= s.days)
            const points = step
                ? step.points
                : gap >= Math.max(CHURN_RULES.shortGapMinDays, 2 * usualGap)
                  ? CHURN_RULES.shortGapPoints
                  : 0
            if (points > 0) {
                reasons.push({
                    code: 'absent',
                    points,
                    text: afterFreeze
                        ? `Не был ${days(gap)} после заморозки`
                        : `Не был на тренировке ${days(daysBetween(now, i.lastVisitAt, tz))}`,
                })
                if (afterFreeze && gap >= CHURN_RULES.shortGapMinDays) {
                    reasons.push({
                        code: 'after_freeze',
                        points: CHURN_RULES.afterFreezePoints,
                        text: 'Не вернулся после заморозки',
                    })
                }
            }
        } else if (
            daysBetween(now, i.joinedAt, tz) >= CHURN_RULES.neverVisitedAfterDays
        ) {
            reasons.push({
                code: 'never_visited',
                points: CHURN_RULES.neverVisitedPoints,
                text: `В клубе ${days(daysBetween(now, i.joinedAt, tz))}, ещё ни разу не был на тренировке`,
            })
        }

        // recent/4 < baseline/8 by at least `minTrendDrop`; a freeze inside
        // the window explains the drop.
        const freezeInWindow =
            freezeEnd !== null && freezeEnd.getTime() > since(CHURN_RULES.windowDays)
        if (
            !freezeInWindow &&
            baseline >= CHURN_RULES.minBaselineVisits &&
            baselinePerWeek > 0
        ) {
            const drop = 1 - recentPerWeek / baselinePerWeek
            if (drop >= CHURN_RULES.minTrendDrop) {
                reasons.push({
                    code: 'declining',
                    points: Math.round(CHURN_RULES.trendMaxPoints * Math.min(1, drop)),
                    text: `Ходит реже: было ~${rate(baselinePerWeek)} в неделю, стало ${rate(recentPerWeek)}`,
                })
            }
        }

        if (i.firstVisitAt) {
            const tenure = daysBetween(now, i.firstVisitAt, tz)
            const visits14 = i.windowVisits.filter(
                (v) => v.getTime() >= since(CHURN_RULES.newcomerWindowDays),
            ).length
            if (
                tenure >= CHURN_RULES.newcomerMinDays &&
                tenure <= CHURN_RULES.newcomerMaxDays &&
                visits14 < CHURN_RULES.newcomerMinVisits
            ) {
                reasons.push({
                    code: 'newcomer',
                    points: CHURN_RULES.newcomerPoints,
                    text: `Новичок: ${days(tenure)} в клубе, за 2 недели — ${visits14} ${pluralRu(visits14, 'визит', 'визита', 'визитов')}`,
                })
            }
        }
    }

    if (i.missedBookings > 0) {
        reasons.push({
            code: 'missed_bookings',
            points: Math.min(
                CHURN_RULES.missedBookingMaxPoints,
                i.missedBookings * CHURN_RULES.missedBookingPoints,
            ),
            text: `Записался и не пришёл: ${i.missedBookings} ${pluralRu(i.missedBookings, 'раз', 'раза', 'раз')} за 30 дней`,
        })
    }

    const positive = reasons.reduce((sum, r) => sum + r.points, 0)
    if (
        positive > 0 &&
        i.firstVisitAt &&
        daysBetween(now, i.firstVisitAt, tz) >= CHURN_RULES.veteranDays
    ) {
        reasons.push({
            code: 'veteran',
            points: CHURN_RULES.veteranPoints,
            text: 'В клубе больше года',
        })
    }

    const score = Math.max(
        0,
        Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0)),
    )
    reasons.sort((a, b) => b.points - a.points)
    return { score, level: churnLevel(score), reasons }
}

// Average monthly spend over the last 180 days: what the club loses per month
// if the member leaves. Paid, non-trial abonements by payment date, divided by
// the months since the first such payment in the window (1..6).
export const monthlySpend = (
    now: Date,
    subs: ReadonlyArray<{
        isPaid: boolean
        isTrial: boolean
        amountPaid: number
        paidAt: Date | null
        createdAt: Date
    }>,
): number => {
    const windowStart = now.getTime() - 180 * DAY_MS
    const paid = subs.filter(
        (s) =>
            s.isPaid &&
            !s.isTrial &&
            s.amountPaid > 0 &&
            (s.paidAt ?? s.createdAt).getTime() >= windowStart &&
            (s.paidAt ?? s.createdAt).getTime() <= now.getTime(),
    )
    if (paid.length === 0) return 0
    const first = Math.min(...paid.map((s) => (s.paidAt ?? s.createdAt).getTime()))
    const months = Math.min(6, Math.max(1, Math.ceil((now.getTime() - first) / (30 * DAY_MS))))
    return Math.round(paid.reduce((sum, s) => sum + s.amountPaid, 0) / months)
}
