// The renewal rule, shared by the «На продление» list and its CSV export.
import {
    currentSubscriptionWhere,
    subscriptionScopeSelect,
} from '../../domains/subscriptions/current-subscriptions'
import {
    isAwaitingFirstVisit,
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import type { Prisma } from '../../infrastructure/prisma'

const DAY_MS = 24 * 60 * 60 * 1000

// How far ahead an ending access window counts as "renew soon".
export const EXPIRING_WINDOW_DAYS = 7
// How long an ended abonement keeps asking for renewal while the member still
// trains on another one. Older ones are a direction the member has dropped,
// not a renewal to chase.
const RECENTLY_ENDED_DAYS = 30

export type RenewalReason = 'out_of_classes' | 'low_classes' | 'access_expiring'
type Reason = RenewalReason

// out_of_classes first (most urgent — can't train), then low_classes, then
// expiring; ties broken by the soonest access expiry.
export const REASON_RANK: Record<Reason, number> = {
    out_of_classes: 0,
    low_classes: 1,
    access_expiring: 2,
}

// The member's abonements renewalNeed judges: every current one plus those
// that ended within RECENTLY_ENDED_DAYS (`subscriptions` relation filter).
export const renewalSubscriptionsWhere = (
    now: Date,
): Prisma.SubscriptionWhereInput => ({
    OR: [
        currentSubscriptionWhere(now),
        {
            status: { in: ['ACTIVE', 'EXPIRED'] },
            endDate: {
                gt: new Date(now.getTime() - RECENTLY_ENDED_DAYS * DAY_MS),
                lte: now,
            },
        },
    ],
})

export const renewalSubscriptionSelect = {
    classesRemaining: true,
    classesTotal: true,
    startDate: true,
    plan: { select: { name: true } },
    ...subscriptionUsabilitySelect,
    ...subscriptionScopeSelect,
} as const satisfies Prisma.SubscriptionSelect

export const renewalSoon = (now: Date) =>
    new Date(now.getTime() + EXPIRING_WINDOW_DAYS * DAY_MS)

type RenewalSub = {
    status: string
    startDate: Date | null
    endDate: Date | null
    classesRemaining: number | null
    directions: ReadonlyArray<{ direction: { id: string } }>
}

export type RenewalNeed<S> = {
    // The abonement to renew (null = none to point at: access lapses with no
    // abonement on record).
    subscription: S | null
    reason: Reason
    // When it ends / ended (falls back to the member's access window).
    end: Date | null
    // Still current — only then its class balance is shown.
    current: boolean
}

// The scope as a set (club-wide = the empty set): two abonements with the
// same key cover the same classes, so one renews the other.
const scopeKey = (s: RenewalSub) =>
    s.directions
        .map((d) => d.direction.id)
        .sort()
        .join(',')

// Why — if at all — a member needs a new abonement, computed over all of
// their abonements (`subs` = current ones plus recently ended ones). A member
// may hold several at once (one per scope), so each scope is judged on its
// own: a pack running out or a term ending is a reason, unless the member
// already holds another current, healthy abonement of the same scope (they
// renewed ahead); an abonement that ended while the member keeps training on
// another scope is a reason until it's renewed. A member with no current
// abonement at all is judged by the access window, exactly as before.
// Returns the most urgent need (reason rank, then soonest end).
export const renewalNeed = <S extends RenewalSub>(
    subs: readonly S[],
    accessUntil: Date | null,
    { now, soon }: { now: Date; soon: Date },
): RenewalNeed<S> | null => {
    const current = subs.filter((s) => isSubscriptionUsable(s, now))
    const ended = subs
        .filter((s) => !isSubscriptionUsable(s, now) && s.endDate !== null)
        .sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime())

    if (current.length === 0) {
        // Only a lapsing/lapsed access window — the old single-abonement
        // rule; point at the abonement that just ended, if any.
        if (accessUntil === null || accessUntil > soon) return null
        return {
            subscription: ended[0] ?? null,
            reason: 'access_expiring',
            end: accessUntil,
            current: false,
        }
    }

    const needs: RenewalNeed<S>[] = []
    const healthy: S[] = []
    for (const s of current) {
        const remaining = s.classesRemaining
        // A started abonement always has an end; a legacy one without falls
        // back to the access window like the old member-level check.
        const end = s.endDate ?? accessUntil
        let reason: Reason | null = null
        if (remaining === 0) reason = 'out_of_classes'
        else if (remaining !== null && remaining <= 1) reason = 'low_classes'
        // A pending abonement's term is only provisional — "renew" would be
        // wrong advice before the first visit.
        else if (!isAwaitingFirstVisit(s) && end !== null && end <= soon) {
            reason = 'access_expiring'
        }
        if (reason) needs.push({ subscription: s, reason, end, current: true })
        else healthy.push(s)
    }
    const open = needs.filter(
        (n) => !healthy.some((h) => scopeKey(h) === scopeKey(n.subscription!)),
    )

    // An ended scope nobody renewed (the latest ended one per scope; a
    // current abonement of that scope speaks for itself above).
    const seen = new Set(current.map(scopeKey))
    for (const s of ended) {
        const key = scopeKey(s)
        if (seen.has(key)) continue
        seen.add(key)
        open.push({
            subscription: s,
            reason: 'access_expiring',
            end: s.endDate,
            current: false,
        })
    }

    const endMs = (d: Date | null) => d?.getTime() ?? Number.MAX_SAFE_INTEGER
    open.sort(
        (a, b) =>
            REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
            endMs(a.end) - endMs(b.end),
    )
    return open[0] ?? null
}

