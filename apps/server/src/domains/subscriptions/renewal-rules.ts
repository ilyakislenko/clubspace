// Renewals and receivables — the one definition behind every surface that asks
// "who should buy the next abonement" or "who still has to pay".
//
// Renewal due (renewalNeed / loadRenewalDue): an ACTIVE student (studentWhere)
// whose class pack is empty or down to its last class, whose abonement term
// ends within RENEWAL_WINDOW_DAYS, or whose abonement / access window ended
// within RENEWAL_LAPSED_DAYS — and who hasn't already bought the next abonement
// of the same scope. Readers: «Удержание → Продлить» (list-renewal-candidates),
// the members filter «Кончается абонемент», the announcement audience «Только
// на продление» (push and feed), the dashboard tile «Продлить», the renewals
// CSV and the AI tool. Ended longer ago is a member who left, not a renewal.
//
// Awaiting payment (awaitingPaymentWhere): an abonement sold and not paid yet,
// still a live sale (ACTIVE or EXPIRED — an expired debt is still a debt; a
// cancelled sale is not), held by a member. Readers: «Продлить → Ожидают
// оплаты» (list-awaiting-payment), the members filter «Должники», the
// dashboard receivable, the class roster's «ждёт оплаты» and the AI tools.
import { memberGuardiansSelect } from '../../features/dependents/schemas'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { studentsIn } from '../metrics/students'
import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    heldSubscriptionWhere,
    subscriptionScopeSelect,
} from './current-subscriptions'
import {
    isAwaitingFirstVisit,
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from './subscription-status'

const DAY_MS = 24 * 60 * 60 * 1000

// How far ahead an ending term counts as "renew soon".
export const RENEWAL_WINDOW_DAYS = 7
// How long an ended abonement (or access window) keeps asking for renewal.
export const RENEWAL_LAPSED_DAYS = 30

export const RENEWAL_REASONS = [
    'out_of_classes',
    'low_classes',
    'access_expiring',
] as const
export type RenewalReason = (typeof RENEWAL_REASONS)[number]

// out_of_classes first (most urgent — can't train), then low_classes, then
// expiring; ties broken by the soonest end.
export const RENEWAL_REASON_RANK: Record<RenewalReason, number> = {
    out_of_classes: 0,
    low_classes: 1,
    access_expiring: 2,
}

const lapsedSince = (now: Date) =>
    new Date(now.getTime() - RENEWAL_LAPSED_DAYS * DAY_MS)

// The member's abonements renewalNeed judges: every current one plus those
// that ended within RENEWAL_LAPSED_DAYS (`subscriptions` relation filter).
export const renewalSubscriptionsWhere = (
    now: Date,
): Prisma.SubscriptionWhereInput => ({
    OR: [
        currentSubscriptionWhere(now),
        {
            status: { in: ['ACTIVE', 'EXPIRED'] },
            endDate: { gt: lapsedSince(now), lte: now },
        },
    ],
})

export const renewalSubscriptionSelect = {
    classesRemaining: true,
    classesTotal: true,
    startDate: true,
    plan: { select: { id: true, name: true } },
    ...subscriptionUsabilitySelect,
    ...subscriptionScopeSelect,
} as const satisfies Prisma.SubscriptionSelect

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
    reason: RenewalReason
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
// their abonements (`subs` = renewalSubscriptionsWhere: current ones plus
// recently ended ones). A member may hold several at once (one per scope), so
// each scope is judged on its own: a pack running out or a term ending is a
// reason, unless the member already holds another current, healthy abonement
// of the same scope (they renewed ahead); an abonement that ended while the
// member keeps training on another scope is a reason until it's renewed. A
// member with no current abonement is judged by the access window (lapsing
// within the window ahead or lapsed within RENEWAL_LAPSED_DAYS). Returns the
// most urgent need (reason rank, then soonest end).
export const renewalNeed = <S extends RenewalSub>(
    subs: readonly S[],
    accessUntil: Date | null,
    now: Date,
): RenewalNeed<S> | null => {
    const soon = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS)
    const current = subs.filter((s) => isSubscriptionUsable(s, now))
    const ended = subs
        .filter((s) => !isSubscriptionUsable(s, now) && s.endDate !== null)
        .sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime())

    if (current.length === 0) {
        // Only a lapsing/lapsed access window; point at the abonement that
        // just ended, if any.
        if (
            accessUntil === null ||
            accessUntil > soon ||
            accessUntil <= lapsedSince(now)
        ) {
            return null
        }
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
        let reason: RenewalReason | null = null
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
            RENEWAL_REASON_RANK[a.reason] - RENEWAL_REASON_RANK[b.reason] ||
            endMs(a.end) - endMs(b.end),
    )
    return open[0] ?? null
}

type RenewalPrisma = Pick<PrismaService, 'workspace' | 'workspaceMember'>

export type RenewalScope = {
    // AND-ed with the student base (a caller's scope or one member).
    memberWhere?: Prisma.WorkspaceMemberWhereInput
}

// Who the rows name (the list, the CSV and the AI tool show the contact; a
// child's contacts are its guardians).
const renewalMemberFields = {
    userId: true,
    accessUntil: true,
    user: {
        select: {
            firstname: true,
            lastname: true,
            email: true,
            phone: true,
            dependentOf: memberGuardiansSelect,
        },
    },
} as const satisfies Prisma.WorkspaceMemberSelect

type RenewalMemberRow = Prisma.WorkspaceMemberGetPayload<{
    select: typeof renewalMemberFields
}>
export type RenewalSubscription = Prisma.SubscriptionGetPayload<{
    select: typeof renewalSubscriptionSelect
}>

export type RenewalDue = RenewalMemberRow & {
    need: RenewalNeed<RenewalSubscription>
}

// Every student due for renewal, most urgent first (reason rank, then the
// soonest end — no end last — then userId, so pages never reshuffle).
export const loadRenewalDue = async (
    prisma: RenewalPrisma,
    workspaceId: string,
    now: Date,
    opts: RenewalScope = {},
): Promise<RenewalDue[]> => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { ownerId: true },
    })
    if (!workspace) return []
    const members = await prisma.workspaceMember.findMany({
        where: studentsIn({
            workspaceId,
            ownerId: workspace.ownerId,
            where: opts.memberWhere,
        }),
        select: {
            ...renewalMemberFields,
            subscriptions: {
                where: renewalSubscriptionsWhere(now),
                orderBy: currentSubscriptionOrderBy,
                select: renewalSubscriptionSelect,
            },
        },
    })
    const due = members.flatMap(({ subscriptions, ...m }) => {
        const need = renewalNeed(subscriptions, m.accessUntil, now)
        return need ? [{ ...m, need }] : []
    })
    const endMs = (r: RenewalDue) =>
        (r.need.end ?? r.accessUntil)?.getTime() ?? Number.MAX_SAFE_INTEGER
    return due.sort(
        (a, b) =>
            RENEWAL_REASON_RANK[a.need.reason] -
                RENEWAL_REASON_RANK[b.need.reason] ||
            endMs(a) - endMs(b) ||
            a.userId.localeCompare(b.userId),
    )
}

export const renewalDueUserIds = async (
    prisma: RenewalPrisma,
    workspaceId: string,
    now: Date,
    opts: RenewalScope = {},
): Promise<string[]> =>
    (await loadRenewalDue(prisma, workspaceId, now, opts)).map((r) => r.userId)

// People, the same set as the «Продлить» list's total.
export const countRenewalsDue = async (
    prisma: RenewalPrisma,
    workspaceId: string,
    now: Date,
    opts: RenewalScope = {},
): Promise<number> =>
    (await loadRenewalDue(prisma, workspaceId, now, opts)).length

// One member (the feed's «Только на продление» check).
export const isRenewalDue = async (
    prisma: RenewalPrisma,
    workspaceId: string,
    userId: string,
    now: Date,
): Promise<boolean> =>
    (
        await loadRenewalDue(prisma, workspaceId, now, {
            memberWhere: { userId },
        })
    ).length > 0

const AWAITING_STATUSES: ('ACTIVE' | 'EXPIRED')[] = ['ACTIVE', 'EXPIRED']

// The receivable, one row per unpaid abonement.
export const awaitingPaymentWhere = (workspaceId: string) =>
    ({
        workspaceId,
        ...heldSubscriptionWhere,
        isPaid: false,
        status: { in: AWAITING_STATUSES },
    }) satisfies Prisma.SubscriptionWhereInput

// The member-side twin: a member holding at least one unpaid abonement
// (the relation implies "held").
export const owesPaymentWhere = {
    subscriptions: {
        some: { isPaid: false, status: { in: AWAITING_STATUSES } },
    },
} as const satisfies Prisma.WorkspaceMemberWhereInput

// People who owe (the «Ожидают оплаты» header and the dashboard tile).
export const countAwaitingPaymentMembers = (
    prisma: Pick<PrismaService, 'workspaceMember'>,
    workspaceId: string,
    opts: RenewalScope = {},
): Promise<number> =>
    prisma.workspaceMember.count({
        where: {
            AND: [{ workspaceId }, owesPaymentWhere, opts.memberWhere ?? {}],
        },
    })
