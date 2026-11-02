// Pure aggregation behind the ИИ-ассистент's reports, unit-tested without a
// database. Money follows revenue.ts (paid rows only, dated by paidOn, the
// dominant currency); dates are club-local.
import {
    dbDateToYmd,
} from '../../domains/subscriptions/freeze-dates'
import {
    isAwaitingFirstVisit,
    isSubscriptionUsable,
} from '../../domains/subscriptions/subscription-status'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    paidOn,
    revenueByPlan,
    revenueTrend,
} from '../get-workspace-stats/revenue'

// ---- Revenue ----

export type RevenueRow = {
    amountPaid: number
    currency: string
    paidAt: Date | null
    createdAt: Date
    planId: string
    planName: string
    directions: { id: string; name: string }[]
}

export type RevenueGroupBy = 'month' | 'tariff' | 'direction'

export type RevenueBucket = {
    key: string
    label: string
    revenue: number
    sales: number
}

export const CLUB_WIDE_KEY = 'club'
export const CLUB_WIDE_LABEL = 'Весь клуб (продажи без направления)'

// Sales grouped by club-local month (every month of the window, oldest
// first), by tariff or by direction (highest revenue first). A sale covering
// several directions is split evenly between them (the remainder goes to the
// first), so the direction totals add up to the club total.
export const groupRevenue = (
    rows: readonly RevenueRow[],
    p: {
        groupBy: RevenueGroupBy
        currency: string | null
        now: Date
        tz: string
        months: number
    },
): RevenueBucket[] => {
    const inCurrency = rows.filter((r) => !p.currency || r.currency === p.currency)
    if (p.groupBy === 'month') {
        const sales = new Map<string, number>()
        for (const r of inCurrency) {
            const key = localDateInTz(paidOn(r), p.tz).slice(0, 7)
            sales.set(key, (sales.get(key) ?? 0) + 1)
        }
        return revenueTrend([...inCurrency], p.now, p.currency, p.tz, p.months).map(
            (m) => ({
                key: m.month,
                label: m.month,
                revenue: m.revenue,
                sales: sales.get(m.month) ?? 0,
            }),
        )
    }
    if (p.groupBy === 'tariff') {
        return revenueByPlan([...inCurrency], p.currency).map((t) => ({
            key: t.planId,
            label: t.planName,
            revenue: t.revenue,
            sales: t.count,
        }))
    }
    const acc = new Map<string, RevenueBucket>()
    const add = (key: string, label: string, revenue: number) => {
        const cur = acc.get(key) ?? { key, label, revenue: 0, sales: 0 }
        cur.revenue += revenue
        cur.sales += 1
        acc.set(key, cur)
    }
    for (const r of inCurrency) {
        if (r.directions.length === 0) {
            add(CLUB_WIDE_KEY, CLUB_WIDE_LABEL, r.amountPaid)
            continue
        }
        const share = Math.floor(r.amountPaid / r.directions.length)
        const rest = r.amountPaid - share * r.directions.length
        r.directions.forEach((d, i) => add(d.id, d.name, share + (i === 0 ? rest : 0)))
    }
    return [...acc.values()].sort((a, b) => b.revenue - a.revenue)
}

// ---- Attendance ----

export type AttendanceSessionRow = {
    id: string
    startAt: Date
    groupId: string | null
    groupName: string | null
    isPersonal: boolean
}

export type AttendanceRecordRow = {
    sessionId: string
    userId: string
    isGuest: boolean | null
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// ISO weekday (1 = Mon) of a club-local calendar date.
const isoWeekday = (ymd: string): number => {
    const day = new Date(`${ymd}T00:00:00Z`).getUTCDay()
    return day === 0 ? 7 : day
}

const mondayOf = (ymd: string): string => {
    const d = new Date(`${ymd}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - (isoWeekday(ymd) - 1))
    return dbDateToYmd(d)
}

const round1 = (n: number) => Math.round(n * 10) / 10

export const aggregateAttendance = (
    sessions: readonly AttendanceSessionRow[],
    records: readonly AttendanceRecordRow[],
    tz: string,
    topCount = 10,
) => {
    const sessionById = new Map(sessions.map((s) => [s.id, s]))
    const checkinsBySession = new Map<string, number>()
    const visitsByUser = new Map<string, number>()
    let guestVisits = 0
    for (const r of records) {
        if (!sessionById.has(r.sessionId)) continue
        checkinsBySession.set(r.sessionId, (checkinsBySession.get(r.sessionId) ?? 0) + 1)
        visitsByUser.set(r.userId, (visitsByUser.get(r.userId) ?? 0) + 1)
        if (r.isGuest) guestVisits += 1
    }

    type Bucket = { sessions: number; checkins: number }
    const byGroup = new Map<string, Bucket & { groupId: string | null; name: string }>()
    const byWeekday = new Map<number, Bucket>()
    const byWeek = new Map<string, Bucket>()
    for (const s of sessions) {
        const checkins = checkinsBySession.get(s.id) ?? 0
        const groupKey = s.groupId ?? (s.isPersonal ? 'personal' : 'other')
        const groupName =
            s.groupName ?? (s.isPersonal ? 'Персональные тренировки' : 'События и разовые занятия')
        const g = byGroup.get(groupKey) ?? {
            groupId: s.groupId,
            name: groupName,
            sessions: 0,
            checkins: 0,
        }
        g.sessions += 1
        g.checkins += checkins
        byGroup.set(groupKey, g)

        const ymd = localDateInTz(s.startAt, tz)
        const wd = byWeekday.get(isoWeekday(ymd)) ?? { sessions: 0, checkins: 0 }
        wd.sessions += 1
        wd.checkins += checkins
        byWeekday.set(isoWeekday(ymd), wd)

        const week = mondayOf(ymd)
        const w = byWeek.get(week) ?? { sessions: 0, checkins: 0 }
        w.sessions += 1
        w.checkins += checkins
        byWeek.set(week, w)
    }

    const totalCheckins = [...checkinsBySession.values()].reduce((a, b) => a + b, 0)
    return {
        totals: {
            sessions: sessions.length,
            checkins: totalCheckins,
            distinctAttendees: visitsByUser.size,
            avgPerSession: sessions.length ? round1(totalCheckins / sessions.length) : 0,
            guestVisits,
        },
        byGroup: [...byGroup.values()]
            .map((g) => ({
                ...g,
                avgPerSession: g.sessions ? round1(g.checkins / g.sessions) : 0,
            }))
            .sort((a, b) => b.checkins - a.checkins),
        byWeekday: [...byWeekday.entries()]
            .sort(([a], [b]) => a - b)
            .map(([day, b]) => ({
                dayOfWeek: day,
                label: WEEKDAY_LABELS[day - 1],
                ...b,
                avgPerSession: b.sessions ? round1(b.checkins / b.sessions) : 0,
            })),
        byWeek: [...byWeek.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([weekStart, b]) => ({ weekStart, ...b })),
        topAttendees: [...visitsByUser.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, topCount)
            .map(([userId, visits]) => ({ userId, visits })),
    }
}

// ---- Abonement states ----

export const ABONEMENT_STATES = [
    'frozen',
    'awaiting_first_visit',
    'out_of_classes',
    'expiring_soon',
    'active',
    'ended',
] as const
export type AbonementState = (typeof ABONEMENT_STATES)[number]

export const ABONEMENT_STATE_LABELS: Record<AbonementState, string> = {
    frozen: 'Заморожен',
    awaiting_first_visit: 'Ждёт первой тренировки',
    out_of_classes: 'Занятия закончились',
    expiring_soon: 'Скоро закончится (7 дней)',
    active: 'Действует',
    ended: 'Закончился (последние 30 дней)',
}

export type AbonementStateRow = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesRemaining: number | null
    freezes: { fromDate: Date; untilDate: Date }[]
}

// One state per abonement, most specific first. «Current» is the shared rule
// (isSubscriptionUsable); a pack at 0 is still current, it reads
// out_of_classes.
export const abonementState = (
    s: AbonementStateRow,
    p: { now: Date; todayYmd: string; soon: Date },
): AbonementState => {
    if (!isSubscriptionUsable(s, p.now)) return 'ended'
    const frozen = s.freezes.some(
        (f) => dbDateToYmd(f.fromDate) <= p.todayYmd && p.todayYmd <= dbDateToYmd(f.untilDate),
    )
    if (frozen) return 'frozen'
    if (isAwaitingFirstVisit(s)) return 'awaiting_first_visit'
    if (s.classesRemaining === 0) return 'out_of_classes'
    if (s.endDate && s.endDate <= p.soon) return 'expiring_soon'
    return 'active'
}
