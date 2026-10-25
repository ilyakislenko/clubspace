// «Кто пропадает»: who is slipping away. Pure rules, no DB — the loader
// (load-workspace-risk.ts) gathers the facts, this decides and words them.
// No ML: four explainable signals a coach can act on with one phone call.
import { formatRuDate } from '../../shared/utils/format-ru-date'
import { pluralRu } from '../../shared/utils/plural-ru'
import { DAY_MS } from '../subscriptions/freeze-dates'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'

// Priority order: the first signal that fired is the member's headline reason.
export const RISK_REASONS = ['lapsed', 'newcomer', 'absent', 'declining'] as const
export type RiskReason = (typeof RISK_REASONS)[number]

export const RISK_RULES = {
    // absent: no visit for this long; the cap is ignored while an abonement is live.
    absentDays: 14,
    absentMaxDays: 90,
    // newcomer: first visit 14-90 days ago and fewer than 2 visits in the last 14.
    newcomerMaxDays: 90,
    newcomerMinTenureDays: 14,
    newcomerWindowDays: 14,
    newcomerMinVisits: 2,
    // declining: the last `recentDays` against the weeks before them in `windowDays`.
    windowDays: 84,
    recentDays: 28,
    minBaselineVisits: 8, // 8 weeks x 1/week
    // lapsed: the abonement ended within this many days.
    lapsedWindowDays: 30,
    contactSnoozeDays: 14,
    // Coaches stopped marking attendance club-wide: attendance signals are off.
    activityGuardDays: 14,
} as const

export type LapseKind = 'expired' | 'out_of_classes' | 'access_ended'

export type MemberRiskInput = {
    now: Date
    // The club had any visit in the last `activityGuardDays`.
    attendanceActive: boolean
    firstVisitAt: Date | null
    lastVisitAt: Date | null
    // Visits in the last `windowDays`.
    windowVisits: Date[]
    frozenNow: boolean
    // Club-local midnight of the day after the newest finished freeze.
    lastFreezeEndAt: Date | null
    // The member's current pointer; may be dead (see isSubscriptionUsable).
    subscription: {
        status: string
        endDate: Date | null
        classesRemaining: number | null
        planName: string
    } | null
    accessUntil: Date | null
}

export type MemberRisk = {
    reason: RiskReason
    signals: RiskReason[]
    facts: {
        lastVisitAt: Date | null
        daysSinceLastVisit: number | null
        firstVisitAt: Date | null
        daysSinceFirstVisit: number | null
        visitsLast14d: number
        recentPerWeek: number
        baselinePerWeek: number
        absentSinceFreeze: boolean
        lapseKind: LapseKind | null
        lapsedAt: Date | null
        planName: string | null
    }
}

type Lapse = { kind: LapseKind; at: Date | null; planName: string | null }

const daysBetween = (later: Date, earlier: Date): number =>
    Math.floor((later.getTime() - earlier.getTime()) / DAY_MS)

const round1 = (x: number): number => Math.round(x * 10) / 10

const detectLapse = (i: MemberRiskInput): Lapse | null => {
    const { now, subscription: sub, accessUntil, lastVisitAt } = i
    const windowStart = now.getTime() - RISK_RULES.lapsedWindowDays * DAY_MS

    if (sub && isSubscriptionUsable(sub, now)) {
        if (
            sub.classesRemaining === 0 &&
            (lastVisitAt == null || lastVisitAt.getTime() > windowStart)
        ) {
            return { kind: 'out_of_classes', at: null, planName: sub.planName }
        }
        // A live pack is not lapsed. This also covers an abonement that waits
        // for its first visit: its endDate is null, so it counts as usable.
        return null
    }

    const manuallyExtended = accessUntil != null && accessUntil.getTime() > now.getTime()
    if (
        sub &&
        sub.status !== 'CANCELLED' &&
        sub.endDate &&
        sub.endDate.getTime() > windowStart &&
        sub.endDate.getTime() <= now.getTime() &&
        !manuallyExtended
    ) {
        return { kind: 'expired', at: sub.endDate, planName: sub.planName }
    }
    if (
        accessUntil &&
        accessUntil.getTime() > windowStart &&
        accessUntil.getTime() <= now.getTime()
    ) {
        return {
            kind: 'access_ended',
            at: accessUntil,
            planName: sub?.planName ?? null,
        }
    }
    return null
}

export const evaluateMemberRisk = (i: MemberRiskInput): MemberRisk | null => {
    // Frozen people are away on purpose.
    if (i.frozenNow) return null

    const { now, firstVisitAt, lastVisitAt, lastFreezeEndAt: freezeEnd } = i
    const signals: RiskReason[] = []

    const lapse = detectLapse(i)
    if (lapse) signals.push('lapsed')

    const since = (days: number): number => now.getTime() - days * DAY_MS
    const visits14 = i.windowVisits.filter(
        (v) => v.getTime() >= since(RISK_RULES.newcomerWindowDays),
    ).length
    const recent = i.windowVisits.filter(
        (v) => v.getTime() >= since(RISK_RULES.recentDays),
    ).length
    const baseline = i.windowVisits.length - recent
    const daysSinceLast = lastVisitAt ? daysBetween(now, lastVisitAt) : null
    const daysSinceFirst = firstVisitAt ? daysBetween(now, firstVisitAt) : null

    if (i.attendanceActive) {
        const hasLive = isSubscriptionUsable(i.subscription, now)

        if (
            daysSinceFirst != null &&
            daysSinceFirst >= RISK_RULES.newcomerMinTenureDays &&
            daysSinceFirst <= RISK_RULES.newcomerMaxDays &&
            visits14 < RISK_RULES.newcomerMinVisits &&
            !(freezeEnd && freezeEnd.getTime() > since(RISK_RULES.newcomerWindowDays))
        ) {
            signals.push('newcomer')
        }

        if (lastVisitAt && daysSinceLast != null) {
            const anchor = freezeEnd && freezeEnd > lastVisitAt ? freezeEnd : lastVisitAt
            if (
                daysBetween(now, anchor) >= RISK_RULES.absentDays &&
                (daysSinceLast <= RISK_RULES.absentMaxDays || hasLive)
            ) {
                signals.push('absent')
            }
        }

        // recent*4 <= baseline is "last-4-week rate <= 50% of the previous
        // 8-week weekly average" in integers (recent/4 <= (baseline/8)/2).
        if (
            !(freezeEnd && freezeEnd.getTime() > since(RISK_RULES.windowDays)) &&
            baseline >= RISK_RULES.minBaselineVisits &&
            recent * 4 <= baseline
        ) {
            signals.push('declining')
        }
    }

    if (signals.length === 0) return null
    signals.sort((a, b) => RISK_REASONS.indexOf(a) - RISK_REASONS.indexOf(b))

    return {
        reason: signals[0],
        signals,
        facts: {
            lastVisitAt,
            daysSinceLastVisit: daysSinceLast,
            firstVisitAt,
            daysSinceFirstVisit: daysSinceFirst,
            visitsLast14d: visits14,
            recentPerWeek: round1(recent / 4),
            baselinePerWeek: round1(baseline / 8),
            absentSinceFreeze:
                freezeEnd != null && lastVisitAt != null && freezeEnd > lastVisitAt,
            lapseKind: lapse?.kind ?? null,
            lapsedAt: lapse?.at ?? null,
            planName: lapse?.planName ?? null,
        },
    }
}

const ago = (d: number): string => {
    if (d <= 0) return 'сегодня'
    if (d === 1) return 'вчера'
    if (d < 14) return `${d} ${pluralRu(d, 'день', 'дня', 'дней')} назад`
    if (d < 60) {
        const w = Math.floor(d / 7)
        return `${w} ${pluralRu(w, 'неделю', 'недели', 'недель')} назад`
    }
    const m = Math.floor(d / 30)
    return `${m} ${pluralRu(m, 'месяц', 'месяца', 'месяцев')} назад`
}

const rate = (x: number): string => String(x).replace('.', ',')

// The Russian «что видно» line, built once on the server so admin, mobile and
// the digest all show the same words.
export const describeRisk = (risk: MemberRisk, tz: string): string => {
    const f = risk.facts
    switch (risk.reason) {
        case 'lapsed': {
            const plan = f.planName ?? ''
            let head: string
            if (f.lapseKind === 'out_of_classes') {
                head = `Закончились занятия в абонементе «${plan}»`
            } else if (f.lapseKind === 'access_ended') {
                head = `Доступ закончился ${f.lapsedAt ? formatRuDate(f.lapsedAt, tz) : ''}`.trim()
            } else {
                head = `Абонемент «${plan}» закончился ${f.lapsedAt ? formatRuDate(f.lapsedAt, tz) : ''}`.trim()
            }
            return f.lastVisitAt
                ? `${head} · последний визит ${ago(f.daysSinceLastVisit ?? 0)}`
                : `${head} · ещё не был ни разу`
        }
        case 'newcomer': {
            const n = f.visitsLast14d
            return `Первый визит ${ago(f.daysSinceFirstVisit ?? 0)}, за 2 недели — ${n} ${pluralRu(n, 'визит', 'визита', 'визитов')}`
        }
        case 'absent':
            return `Последний визит ${ago(f.daysSinceLastVisit ?? 0)}${f.absentSinceFreeze ? ' · после заморозки' : ''}`
        case 'declining':
            return `Было ~${rate(f.baselinePerWeek)}/нед, стало ${rate(f.recentPerWeek)}/нед`
    }
}

// A contact hides the member for 14 days, unless a signal the contact did not
// know about has appeared since.
export const isSnoozed = (
    contact: { at: Date; signals: RiskReason[] } | null,
    risk: MemberRisk,
    now: Date,
): boolean =>
    !!contact &&
    now.getTime() - contact.at.getTime() < RISK_RULES.contactSnoozeDays * DAY_MS &&
    risk.signals.every((s) => contact.signals.includes(s))

export type RiskSummary = {
    total: number
    lapsed: number
    newcomer: number
    absent: number
    declining: number
    snoozed: number
}

// Snoozed entries count only in `snoozed`.
export const summarizeRisk = (
    entries: { risk: MemberRisk; snoozed: boolean }[],
): RiskSummary => {
    const out: RiskSummary = {
        total: 0,
        lapsed: 0,
        newcomer: 0,
        absent: 0,
        declining: 0,
        snoozed: 0,
    }
    for (const e of entries) {
        if (e.snoozed) {
            out.snoozed += 1
            continue
        }
        out.total += 1
        out[e.risk.reason] += 1
    }
    return out
}
