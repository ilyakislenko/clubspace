// «Выплаты тренерам» (docs/design/2026-11-26-coach-payroll.md §1): the one
// payroll rule — which classes count, whom they are credited to, how a
// percent rate's money base is attributed and what each part of a rate pays.
// Pure: the loader (payroll-loader.ts) reads the rows, this file decides.

import { wallClockToUtc } from '../../features/attendance/attendance-utils'
import { shiftMonth } from '../metrics/revenue'

// A club-local calendar month, "2026-11".
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// The month's 1st as a `@db.Date` value (UTC midnight), the key of every
// payroll row.
export const monthToDbDate = (month: string): Date => new Date(`${month}-01T00:00:00Z`)

export const dbDateToMonth = (d: Date): string => d.toISOString().slice(0, 7)

// The instants the month's money is bounded by: club-local midnight of its
// 1st and of the next month's 1st (exclusive).
export const monthBounds = (month: string, tz: string): { start: Date; end: Date } => ({
    start: wallClockToUtc(`${month}-01T00:00`, tz),
    end: wallClockToUtc(`${shiftMonth(month, 1)}-01T00:00`, tz),
})

// ---- Classes ----

export type PayrollSessionFact = {
    id: string
    groupId: string | null
    groupName: string | null
    // The group's coaches (primary + assistants) — a credited coach outside
    // them stood in («замена»).
    groupCoachIds: string[]
    // The group's primary coach (roster fallback and «вёл другой» in the panel).
    groupPrimaryCoachId: string | null
    // The schedule slot a scheduled class was opened for — kept from its
    // occurrence key when the slot was deleted since (slotId SetNull); null =
    // an ad-hoc class.
    scheduledSlotId: string | null
    // Slot-local calendar day, "2026-11-03".
    sessionDate: string
    startAt: Date
    isPersonal: boolean
    workspaceEventId: string | null
    // «Кто вёл»: already the approved substitute (attendance + substitutions keep it).
    coachId: string | null
    records: { userId: string; usedSubscriptionId: string | null }[]
}

export type PayrollExceptionFact = {
    groupId: string
    slotId: string | null
    fromDate: Date
    untilDate: Date
}

export type PayrollClass = {
    sessionId: string
    date: string
    startAt: Date
    groupId: string
    groupName: string
    groupCoachIds: string[]
    groupPrimaryCoachId: string | null
    coachId: string | null
    // Present-marks except the coach's own; guests count.
    marks: number
    // The abonements those marks used (one entry per mark that used one).
    subscriptionIds: string[]
}

// The month's group classes: `counted` ones pay, `cancelled` ones (a
// cancellation added after the roster was opened) are listed but never pay.
// Personal trainings, events and groupless sessions are not classes here
// (they are paid through adjustments).
//
// An opened class was checked against its slot when it was created, so only
// the cancellations decide now — never the slot's current weekday or
// effective range (editing a slot later must not un-count classes held on
// it). A moved class's origin date is cancelled by the move; its one-off slot
// holds it. A class whose slot was deleted is still tested against the
// group's cancellations (the slot's own ones went with it).
export const countedClasses = (
    month: string,
    sessions: readonly PayrollSessionFact[],
    exceptions: readonly PayrollExceptionFact[],
): { counted: PayrollClass[]; cancelled: PayrollClass[] } => {
    const counted: PayrollClass[] = []
    const cancelled: PayrollClass[] = []
    for (const s of sessions) {
        if (!s.groupId || s.isPersonal || s.workspaceEventId) continue
        if (!s.sessionDate.startsWith(`${month}-`)) continue
        const marked = s.records.filter((r) => r.userId !== s.coachId)
        const cls: PayrollClass = {
            sessionId: s.id,
            date: s.sessionDate,
            startAt: s.startAt,
            groupId: s.groupId,
            groupName: s.groupName ?? '',
            groupCoachIds: s.groupCoachIds,
            groupPrimaryCoachId: s.groupPrimaryCoachId,
            coachId: s.coachId,
            marks: marked.length,
            subscriptionIds: marked.flatMap((r) =>
                r.usedSubscriptionId ? [r.usedSubscriptionId] : [],
            ),
        }
        const date = new Date(`${s.sessionDate}T00:00:00Z`)
        const isCancelled =
            s.scheduledSlotId !== null &&
            exceptions.some(
                (e) =>
                    e.groupId === s.groupId &&
                    (e.slotId === null || e.slotId === s.scheduledSlotId) &&
                    e.fromDate <= date &&
                    e.untilDate >= date,
            )
        ;(isCancelled ? cancelled : counted).push(cls)
    }
    const byTime = (a: PayrollClass, b: PayrollClass) =>
        a.startAt.getTime() - b.startAt.getTime() || a.sessionId.localeCompare(b.sessionId)
    return { counted: counted.sort(byTime), cancelled: cancelled.sort(byTime) }
}

// ---- Rates ----

export type PayrollRateRow = {
    coachId: string
    effectiveFrom: Date
    fixedMonthly: number
    perClass: number
    perClassMinStudents: number
    perStudent: number
    revenueBp: number
    currency: string
}

// The rate values a line used (stored on a closed line as JSON).
export type PayrollRateValues = {
    effectiveFrom: string
    fixedMonthly: number
    perClass: number
    perClassMinStudents: number
    perStudent: number
    revenueBp: number
    currency: string
}

export const rateValues = (r: PayrollRateRow): PayrollRateValues => ({
    effectiveFrom: dbDateToMonth(r.effectiveFrom),
    fixedMonthly: r.fixedMonthly,
    perClass: r.perClass,
    perClassMinStudents: r.perClassMinStudents,
    perStudent: r.perStudent,
    revenueBp: r.revenueBp,
    currency: r.currency,
})

// The rate in force for a month: the latest one from that month or earlier.
export const rateFor = <R extends { effectiveFrom: Date }>(
    rates: readonly R[],
    month: string,
): R | null => {
    const first = monthToDbDate(month).getTime()
    let best: R | null = null
    for (const r of rates) {
        if (r.effectiveFrom.getTime() > first) continue
        if (!best || r.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = r
    }
    return best
}

// ---- Revenue base ----

// A sale (+amountPaid) or a refund of one (−amount) of an abonement, in the month.
export type PayrollRevenueRow = {
    subscriptionId: string
    // The abonement's holder (roster fallback).
    userId: string | null
    amount: number
    currency: string
}

// Splits `amount` by integer weights with the largest-remainder method, so
// the parts sum exactly to it. Ties go to the smaller key (deterministic).
export const splitByWeights = (
    amount: number,
    weights: ReadonlyArray<readonly [string, number]>,
): Map<string, number> => {
    const parts = new Map<string, number>()
    const positive = weights.filter(([, w]) => w > 0)
    const total = positive.reduce((sum, [, w]) => sum + w, 0)
    if (total === 0) return parts
    const sign = amount < 0 ? -1 : 1
    const abs = Math.abs(amount)
    const shares = positive.map(([key, w]) => ({
        key,
        floor: Math.floor((abs * w) / total),
        rem: (abs * w) % total,
    }))
    let left = abs - shares.reduce((sum, s) => sum + s.floor, 0)
    const order = [...shares].sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key))
    for (const s of order) {
        if (left === 0) break
        s.floor += 1
        left -= 1
    }
    for (const s of shares) parts.set(s.key, (parts.get(s.key) ?? 0) + sign * s.floor)
    return parts
}

// Marks per abonement per crediting coach, over the month's counted classes
// that have a coach.
export const marksBySubscription = (
    classes: readonly PayrollClass[],
): Map<string, Map<string, number>> => {
    const bySub = new Map<string, Map<string, number>>()
    for (const c of classes) {
        if (!c.coachId) continue
        for (const subId of c.subscriptionIds) {
            const perCoach = bySub.get(subId) ?? new Map<string, number>()
            perCoach.set(c.coachId, (perCoach.get(c.coachId) ?? 0) + 1)
            bySub.set(subId, perCoach)
        }
    }
    return bySub
}

export type RevenueAttribution = {
    byCoach: Map<string, number>
    // Money of the club's currency that found neither visits nor a group.
    unattributed: number
    // Rows in another currency (a count: their sum would mix currencies).
    otherCurrency: number
}

// Each row goes to the coaches its abonement's marks in this month's counted
// classes were credited to (proportionally); without such marks, equally to
// the primary coaches of the holder's current groups; else unattributed.
export const attributeRevenue = (
    rows: readonly PayrollRevenueRow[],
    marksBySub: ReadonlyMap<string, ReadonlyMap<string, number>>,
    rosterCoaches: ReadonlyMap<string, readonly string[]>,
    currency: string,
): RevenueAttribution => {
    const byCoach = new Map<string, number>()
    let unattributed = 0
    let otherCurrency = 0
    const add = (parts: Map<string, number>) => {
        for (const [coachId, v] of parts) byCoach.set(coachId, (byCoach.get(coachId) ?? 0) + v)
    }
    for (const row of rows) {
        if (row.currency !== currency) {
            otherCurrency += 1
            continue
        }
        const marks = marksBySub.get(row.subscriptionId)
        if (marks && marks.size > 0) {
            add(splitByWeights(row.amount, [...marks.entries()]))
            continue
        }
        const roster = row.userId ? [...new Set(rosterCoaches.get(row.userId) ?? [])] : []
        if (roster.length > 0) {
            add(splitByWeights(row.amount, roster.map((id) => [id, 1] as const)))
            continue
        }
        unattributed += row.amount
    }
    return { byCoach, unattributed, otherCurrency }
}

// ---- Lines ----

export type PayrollAdjustmentRow = {
    id: string
    coachId: string
    amount: number
    // The club's payroll currency when it was added.
    currency: string
    comment: string
    createdAt: Date
    createdByName: string
}

export type PayrollAmounts = {
    fixed: number
    classes: number
    students: number
    revenue: number
    adjustments: number
}

export type PayrollLineFact = {
    coachId: string
    name: string
    rate: PayrollRateValues | null
    // The rate in force but in another currency than the month's: never
    // reinterpreted — it pays nothing until a rate in the month's currency is set.
    ignoredRate: PayrollRateValues | null
    classes: number
    classesPaid: number
    marks: number
    marksPaid: number
    revenueBase: number
    amounts: PayrollAmounts
    total: number
}

// A class pays when its marks reach the coach's threshold (no rate: 1).
export const isPaidClass = (marks: number, rate: { perClassMinStudents: number } | null) =>
    marks >= (rate ? rate.perClassMinStudents : 1)

// One line per coach with a counted class, an adjustment, or a rate in force
// while on staff that month (`staffIds`); sorted by name. The parts never go
// negative — only an adjustment can take the total below zero, and nothing
// is clamped there. A rate or an adjustment in another currency than the
// month's (`currency`) is left out of the amounts and flagged, never
// reinterpreted in the month's currency.
export const computeLines = (p: {
    month: string
    currency: string
    classes: readonly PayrollClass[]
    rates: readonly PayrollRateRow[]
    adjustments: readonly PayrollAdjustmentRow[]
    revenueByCoach: ReadonlyMap<string, number>
    staffIds: ReadonlySet<string>
    names: ReadonlyMap<string, string>
    fallbackName: string
}): PayrollLineFact[] => {
    const ratesByCoach = new Map<string, PayrollRateRow[]>()
    for (const r of p.rates) {
        ratesByCoach.set(r.coachId, [...(ratesByCoach.get(r.coachId) ?? []), r])
    }
    const coachIds = new Set<string>()
    for (const c of p.classes) if (c.coachId) coachIds.add(c.coachId)
    for (const a of p.adjustments) coachIds.add(a.coachId)
    for (const [coachId, rates] of ratesByCoach) {
        if (p.staffIds.has(coachId) && rateFor(rates, p.month)) coachIds.add(coachId)
    }

    const lines = [...coachIds].map((coachId): PayrollLineFact => {
        const inForce = rateFor(ratesByCoach.get(coachId) ?? [], p.month)
        const rate = inForce && inForce.currency === p.currency ? inForce : null
        const own = p.classes.filter((c) => c.coachId === coachId)
        const paid = own.filter((c) => isPaidClass(c.marks, rate))
        const marks = own.reduce((sum, c) => sum + c.marks, 0)
        const marksPaid = paid.reduce((sum, c) => sum + c.marks, 0)
        const revenueBase = p.revenueByCoach.get(coachId) ?? 0
        const adjustments = p.adjustments
            .filter((a) => a.coachId === coachId && a.currency === p.currency)
            .reduce((sum, a) => sum + a.amount, 0)
        const amounts: PayrollAmounts = rate
            ? {
                  fixed: rate.fixedMonthly,
                  classes: paid.length * rate.perClass,
                  students: marksPaid * rate.perStudent,
                  revenue: Math.max(0, Math.round((revenueBase * rate.revenueBp) / 10000)),
                  adjustments,
              }
            : { fixed: 0, classes: 0, students: 0, revenue: 0, adjustments }
        return {
            coachId,
            name: p.names.get(coachId) ?? p.fallbackName,
            rate: rate ? rateValues(rate) : null,
            ignoredRate: inForce && !rate ? rateValues(inForce) : null,
            classes: own.length,
            classesPaid: paid.length,
            marks,
            marksPaid,
            revenueBase,
            amounts,
            total:
                amounts.fixed +
                amounts.classes +
                amounts.students +
                amounts.revenue +
                amounts.adjustments,
        }
    })
    return lines.sort(
        (a, b) => a.name.localeCompare(b.name, 'ru') || a.coachId.localeCompare(b.coachId),
    )
}
