// A member's current abonements — the one rule every reader uses.
//
// A member may hold several at once («БЖЖ 12 занятий» and «Тайский бокс 8»),
// so there is no single "current" pointer any more. Current = ACTIVE and not
// past its endDate (a null endDate is a pure class pack or one still waiting for
// its first visit — never expired). This is the query form of
// isSubscriptionUsable(); a pack with 0 classes left is still current (it reads
// "0 / 12" and, per the club's rules, running out never revokes app access).
//
// Each abonement carries its scope — the directions it may be spent on,
// snapshotted from the tariff at sale (SubscriptionDirection). Empty = club-wide.
import { directionRefSelect } from '../directions/direction-ref'
import type { Prisma } from '../../infrastructure/prisma'

export const currentSubscriptionWhere = (
    now: Date = new Date(),
): Prisma.SubscriptionWhereInput => ({
    status: 'ACTIVE',
    OR: [{ endDate: null }, { endDate: { gt: now } }],
})

// Display order of a member's current abonements: the one ending soonest first
// (open-ended / not started yet last), then the older sale.
export const currentSubscriptionOrderBy: Prisma.SubscriptionOrderByWithRelationInput[] =
    [{ endDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]

// Scope ids only (deduction, filters).
export const subscriptionScopeIdsSelect = {
    directions: { select: { directionId: true } },
} as const

export const scopeDirectionIds = (s: {
    directions: ReadonlyArray<{ directionId: string }>
}): string[] => s.directions.map((d) => d.directionId)

// Scope with names/colors for DTOs (serializeSubscription).
export const subscriptionScopeSelect = {
    directions: {
        select: { direction: directionRefSelect },
        orderBy: [{ direction: { order: 'asc' } }, { direction: { name: 'asc' } }],
    },
} as const satisfies Prisma.SubscriptionInclude

// `include` for a row passed to serializeSubscription (plan name + scope).
export const subscriptionDtoInclude = {
    plan: { select: { id: true, name: true } },
    ...subscriptionScopeSelect,
} as const satisfies Prisma.SubscriptionInclude

// The scope of a sale, copied from the tariff: nested create for
// tx.subscription.create({ data: { ..., directions: scopeSnapshotCreate(ids) } }).
export const scopeSnapshotCreate = (directionIds: readonly string[]) => ({
    create: directionIds.map((directionId) => ({ directionId })),
})

// May an abonement of this scope be spent on a class of `sessionDirection`?
// Club-wide (empty scope) covers every class; a scoped one only classes of one
// of its directions — never a class without a direction.
export const scopeCoversDirection = (
    scope: readonly string[],
    sessionDirection: string | null,
): boolean =>
    scope.length === 0 ||
    (sessionDirection !== null && scope.includes(sessionDirection))

// May an abonement of this scope be spent on any of a member's directions?
// (Online purchase offers tariffs matching the member's directions plus
// club-wide ones.)
export const scopeMatchesAny = (
    scope: readonly string[],
    directions: ReadonlySet<string>,
): boolean => scope.length === 0 || scope.some((d) => directions.has(d))
