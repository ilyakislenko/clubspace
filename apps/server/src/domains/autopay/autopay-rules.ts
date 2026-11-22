// Member autopay — the pure rules (docs/design/2026-11-15-member-autopay.md §1).
// Everything here is club-local: `S` is the club-local day the renewal starts,
// localDateInTz(anchor.endDate) — the day onlineGrantStart renews from.
import {
    localDateInTz,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import {
    sameScope,
    scopeDirectionIds,
} from '../subscriptions/current-subscriptions'
import { addDaysYmd } from '../subscriptions/freeze-dates'
import { RENEWAL_LAPSED_DAYS } from '../subscriptions/renewal-rules'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'

// Attempts per renewed abonement: S − 1, S, S + 1, S + 3 for a term.
export const MAX_AUTOPAY_ATTEMPTS = 4
// Charges and reminders run only between these club-local hours ([from, to)).
export const AUTOPAY_WINDOW = { from: 10, to: 20 } as const
// The pre-charge reminder comes this many days before the charge.
export const AUTOPAY_REMINDER_DAYS = 3
// A used-up pack is charged only this long after its last deducting check-in,
// so a coach can still undo a mistaken mark (unmark refunds the class).
export const PACK_CHARGE_DELAY_MS = 60 * 60 * 1000

export const AUTOPAY_NEEDS_ACTION_REASONS = [
    'CHARGE_FAILED',
    'CARD_EXPIRED',
    'TERMS_CHANGED',
    'GRANT_REFUSED',
] as const
export type AutopayNeedsActionReason = (typeof AUTOPAY_NEEDS_ACTION_REASONS)[number]

export const AUTOPAY_CANCEL_SOURCES = ['MEMBER', 'STAFF', 'SYSTEM'] as const
export type AutopayCancelSource = (typeof AUTOPAY_CANCEL_SOURCES)[number]

const DAY_MS = 24 * 60 * 60 * 1000
const at10 = (ymd: string, tz: string) =>
    wallClockToUtc(`${ymd}T${String(AUTOPAY_WINDOW.from).padStart(2, '0')}:00`, tz)

// One of the member's abonements, as the rules read it.
export type AutopayAbonement = {
    id: string
    status: string
    startDate: Date | null
    endDate: Date | null
    classesTotal: number | null
    classesRemaining: number | null
    createdAt: Date
    directions: ReadonlyArray<{ directionId: string }>
}

// Latest first: one still waiting for its first visit (no end yet) is the
// newest sale; otherwise the later end, then the later sale.
const latestFirst = (a: AutopayAbonement, b: AutopayAbonement): number => {
    const ae = a.endDate?.getTime() ?? Number.POSITIVE_INFINITY
    const be = b.endDate?.getTime() ?? Number.POSITIVE_INFINITY
    if (ae !== be) return be - ae
    return b.createdAt.getTime() - a.createdAt.getTime()
}

// What the next charge renews: the member's latest abonement of the tariff's
// scope that is not CANCELLED, current or ended within RENEWAL_LAPSED_DAYS.
// `subs` are the member's held abonements (any status). A same-scope sale by
// staff or by the member moves it, so a paid period is never charged again.
export const pickAnchor = <T extends AutopayAbonement>(
    subs: readonly T[],
    planScope: readonly string[],
    now: Date,
): T | null => {
    const lapsedSince = now.getTime() - RENEWAL_LAPSED_DAYS * DAY_MS
    const candidates = subs
        .filter((s) => s.status !== 'CANCELLED')
        .filter((s) => sameScope(scopeDirectionIds(s), planScope))
        .filter((s) => s.endDate === null || s.endDate.getTime() > lapsedSince)
        .sort(latestFirst)
    return candidates[0] ?? null
}

// Staff cancelled the member's latest same-scope abonement and nothing of
// that scope is current: there is nothing to renew (the agreement cancels).
export const anchorCancelledByClub = (
    subs: readonly AutopayAbonement[],
    planScope: readonly string[],
    now: Date,
): boolean => {
    const same = subs.filter((s) => sameScope(scopeDirectionIds(s), planScope))
    if (same.some((s) => isSubscriptionUsable(s, now))) return false
    const newest = [...same].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0]
    return newest?.status === 'CANCELLED'
}

// S: the club-local day the renewal starts (null: no end to renew from).
export const renewalStartYmd = (
    anchor: Pick<AutopayAbonement, 'startDate' | 'endDate'>,
    tz: string,
): string | null =>
    anchor.startDate === null || anchor.endDate === null
        ? null
        : localDateInTz(anchor.endDate, tz)

export type AutopayDueKind = 'term' | 'pack'

export const anchorKind = (
    anchor: Pick<AutopayAbonement, 'classesTotal'>,
): AutopayDueKind => (anchor.classesTotal === null ? 'term' : 'pack')

// When the charge for this anchor is due (§1 table), or null (waits for its
// first visit — onlineGrantStart refuses it). A term: S − 1 10:00. A pack: the
// first of «used up and the last deducting check-in ≥ 1 h old» and its term
// end — S 10:00, or the pack's own end time when that is later the same day:
// while classes are left the pack is live, and the grant refuses a new pack
// over a live one with classes (onlineGrantStart / grantFromPlan), so charging
// earlier would take money for an abonement that can't be granted.
// `lastUsedAt`: when the pack's last class went (null: unknown).
// A started pack with no end date (an old or imported sale) has no term end:
// it is charged only when used up (1 h after the last class); while classes
// remain it is current and nothing is due. After that charge the new pack has
// an end, so the usual lapse rule applies from then on.
export const autopayDueAt = (
    anchor: Pick<
        AutopayAbonement,
        'startDate' | 'endDate' | 'classesTotal' | 'classesRemaining'
    >,
    tz: string,
    lastUsedAt: Date | null,
): Date | null => {
    if (anchor.startDate !== null && anchor.endDate === null && anchor.classesTotal !== null) {
        return (anchor.classesRemaining ?? 0) > 0
            ? null
            : new Date((lastUsedAt ?? anchor.startDate).getTime() + PACK_CHARGE_DELAY_MS)
    }
    const s = renewalStartYmd(anchor, tz)
    if (s === null) return null
    if (anchor.classesTotal === null) return at10(addDaysYmd(s, -1), tz)
    const s10 = at10(s, tz)
    const termDue = anchor.endDate !== null && anchor.endDate > s10 ? anchor.endDate : s10
    if ((anchor.classesRemaining ?? 0) > 0) return termDue
    const usedUp = new Date(
        (lastUsedAt ?? anchor.startDate ?? termDue).getTime() + PACK_CHARGE_DELAY_MS,
    )
    return usedUp < termDue ? usedUp : termDue
}

// The pre-charge reminder: 10:00 three days before the scheduled charge day —
// S − 4 for a term (charged S − 1), S − 3 for a pack (charged at S at the
// latest); a pack only while classes remain (an emptied pack is charged
// within the hour).
export const reminderAt = (
    anchor: Pick<
        AutopayAbonement,
        'startDate' | 'endDate' | 'classesTotal' | 'classesRemaining'
    >,
    tz: string,
): Date | null => {
    const s = renewalStartYmd(anchor, tz)
    if (s === null) return null
    if (anchor.classesTotal === null) {
        return at10(addDaysYmd(s, -(AUTOPAY_REMINDER_DAYS + 1)), tz)
    }
    if ((anchor.classesRemaining ?? 0) <= 0) return null
    return at10(addDaysYmd(s, -AUTOPAY_REMINDER_DAYS), tz)
}

// 10:00 ≤ club-local time < 20:00.
export const inChargeWindow = (now: Date, tz: string): boolean => {
    const hour = Number(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: tz,
            hour: '2-digit',
            hour12: false,
        })
            .formatToParts(now)
            .find((p) => p.type === 'hour')?.value ?? '0',
    ) % 24
    return hour >= AUTOPAY_WINDOW.from && hour < AUTOPAY_WINDOW.to
}

// After the n-th decline in a row the next attempt is at 10:00 club-local on
// the next day, the day after, then two days later; null after the 4th.
export const autopayRetryAt = (
    now: Date,
    tz: string,
    failedAttempts: number,
): Date | null => {
    if (failedAttempts >= MAX_AUTOPAY_ATTEMPTS) return null
    const gap = failedAttempts >= 3 ? 2 : 1
    return at10(addDaysYmd(localDateInTz(now, tz), gap), tz)
}

export type AutopayTerms = {
    termsAmount: number
    currency: string
    termsDurationDays: number
    termsClassCount: number | null
}

export type TermsCheck = 'ok' | 'lower' | 'changed'

// A renewal is charged only on the agreed terms: the same currency, term and
// pack size and an amount no higher than agreed (a lower one is charged and
// lowers it).
export const termsCheck = (
    agreement: AutopayTerms,
    plan: { durationDays: number; classCount: number | null; currency: string },
    amount: number,
): TermsCheck => {
    if (
        plan.currency !== agreement.currency ||
        plan.durationDays !== agreement.termsDurationDays ||
        plan.classCount !== agreement.termsClassCount ||
        amount > agreement.termsAmount
    ) {
        return 'changed'
    }
    return amount < agreement.termsAmount ? 'lower' : 'ok'
}

// What the member and staff read as «следующее списание»: the club-local day
// of the due charge (a pack: «когда закончатся занятия, не позже {on}» — the
// term end S), or null when nothing is due (waits for its first visit).
export const autopayNextChargeOn = (
    anchor: Pick<
        AutopayAbonement,
        'startDate' | 'endDate' | 'classesTotal' | 'classesRemaining'
    >,
    tz: string,
    lastUsedAt: Date | null,
): { on: string; kind: AutopayDueKind } | null => {
    const due = autopayDueAt(anchor, tz, lastUsedAt)
    if (!due) return null
    const kind = anchorKind(anchor)
    if (kind === 'pack') {
        const s = renewalStartYmd(anchor, tz)
        return s ? { on: (anchor.classesRemaining ?? 0) > 0 ? s : localDateInTz(due, tz), kind } : null
    }
    return { on: localDateInTz(due, tz), kind }
}

// The live-agreement key: one live agreement per member and tariff.
export const autopayLiveKey = (userId: string, planId: string) =>
    `${userId}:${planId}`

// The provider's Idempotence-Key of a renewal charge: one per renewed
// abonement and attempt (≤ 48 characters, Payment.idempotenceKey is 64).
export const autopayIdempotenceKey = (anchorId: string, attempt: number) =>
    `autopay:${anchorId}:${attempt}`

// «карта •• 4444» / «сохранённый способ оплаты» (never the token).
export const autopayCardLabel = (cardLast4: string | null): string =>
    cardLast4 ? `карта •• ${cardLast4}` : 'сохранённый способ оплаты'
