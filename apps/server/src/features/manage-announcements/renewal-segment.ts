import { currentSubscriptionWhere } from '../../domains/subscriptions/current-subscriptions'
import { Prisma } from '../../infrastructure/prisma'

const WINDOW_DAYS = 7

// Members none of whose abonements is waiting for its first visit. A pending
// abonement's access window is only provisional, so "expiring" doesn't apply
// (the Prisma twin of isAwaitingFirstVisit over all of the member's
// abonements; `none` also holds for a member without any).
export const notAwaitingFirstVisitWhere: Prisma.WorkspaceMemberWhereInput = {
    subscriptions: { none: { status: 'ACTIVE', startDate: null } },
}

// The "due for renewal" segment: access expiring within a week (incl. already
// expired) OR any current class-pack down to its last visit. A member may hold
// several abonements; the access window is one per member (the latest end of
// them), so it lapses only when all of them do. One rule, expressed two ways
// so the push fan-out (a Prisma filter) and the feed (a per-member predicate)
// stay in sync.
export const expiringSegmentWhere = (
    now = new Date(),
): Prisma.WorkspaceMemberWhereInput => {
    const soon = new Date(now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000)
    return {
        OR: [
            { accessUntil: { lte: soon }, ...notAwaitingFirstVisitWhere },
            {
                subscriptions: {
                    some: {
                        ...currentSubscriptionWhere(now),
                        classesRemaining: { lte: 1 },
                    },
                },
            },
        ],
    }
}

// The per-member twin of expiringSegmentWhere. Over several current
// abonements: classesRemaining = the lowest balance among the current class
// packs (null = no pack), awaitingFirstVisit = any of them still pending —
// see lowestClassesRemaining / anyAwaitingFirstVisit.
export const isExpiringMember = (
    m: {
        accessUntil: Date | null
        classesRemaining: number | null
        awaitingFirstVisit?: boolean
    },
    now = new Date(),
): boolean => {
    const soon = now.getTime() + WINDOW_DAYS * 24 * 3600 * 1000
    const accessExpiring =
        !m.awaitingFirstVisit &&
        m.accessUntil != null &&
        m.accessUntil.getTime() <= soon
    const lowClasses = m.classesRemaining != null && m.classesRemaining <= 1
    return accessExpiring || lowClasses
}

// The lowest class balance among a member's current abonements (null = none
// of them is a class pack) — feeds isExpiringMember.
export const lowestClassesRemaining = (
    current: ReadonlyArray<{ classesRemaining: number | null }>,
): number | null =>
    current.reduce<number | null>(
        (min, s) =>
            s.classesRemaining === null
                ? min
                : min === null
                  ? s.classesRemaining
                  : Math.min(min, s.classesRemaining),
        null,
    )
