// One definition of "this abonement is the member's current, usable one".
//
// `WorkspaceMember.subscriptionId` is only a pointer. Nothing kept it in step
// with the row it points at: cancelling clears it, but a subscription that
// simply ran out of days stayed pointed-at forever. Every reader then invented
// its own answer — the roster displayed an expired pack as if it were live,
// and the check-in flow happily burned classes out of it. This is the shared
// answer they all use now.
//
// Deliberately NOT part of the test: `classesRemaining === 0`. A pack with no
// classes left is still the member's current pack — it should read "0 / 12"
// rather than vanish, and per the club's rules running out never revokes app
// access. Only the burn step cares about the balance being > 0.

export type SubscriptionUsability = {
    status: string
    endDate: Date | null
}

export const isSubscriptionUsable = (
    subscription: SubscriptionUsability | null | undefined,
    now: Date = new Date(),
): boolean => {
    if (!subscription) return false
    if (subscription.status !== 'ACTIVE') return false
    // A null endDate means "no time limit" (a pure class pack) or "not started
    // yet" (waits for the first visit) — never "expired".
    if (subscription.endDate && subscription.endDate.getTime() <= now.getTime()) {
        return false
    }
    return true
}

// An abonement sold on a «срок с первой тренировки» tariff that has not had its
// first visit yet. It is still the member's current, usable one (classes deduct
// from it, it blocks a second sale) — it just has no dates.
export const isAwaitingFirstVisit = (
    s: { status: string; startDate: Date | null } | null | undefined,
): boolean => !!s && s.status === 'ACTIVE' && s.startDate === null

// Prisma `select` for the fields isSubscriptionUsable needs, so callers can't
// forget one and silently get `undefined` (which would read as "not expired").
export const subscriptionUsabilitySelect = {
    status: true,
    endDate: true,
} as const
