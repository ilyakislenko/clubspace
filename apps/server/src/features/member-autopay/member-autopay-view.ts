import {
    autopaySchedule,
    loadAutopayAbonements,
} from '../../domains/autopay/autopay-anchor'
import { AUTOPAY_CONSENT_VERSION } from '../../domains/autopay/autopay-consent'
import {
    type AutopayRenewalPrice,
    autopayRenewalPrice,
} from '../../domains/autopay/autopay-offer'
import {
    AUTOPAY_CANCEL_SOURCES,
    AUTOPAY_NEEDS_ACTION_REASONS,
    type AutopayCancelSource,
    type AutopayDueKind,
    type AutopayNeedsActionReason,
    autopayCardLabel,
    termsCheck,
} from '../../domains/autopay/autopay-rules'
import { scopeDirectionIds } from '../../domains/subscriptions/current-subscriptions'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { displayName } from '../attendance/schemas'
import { localDateInTz } from '../attendance/attendance-utils'

const DAY_MS = 24 * 60 * 60 * 1000

// A cancelled agreement stays visible this long: the member sees the
// confirmation of the refusal, staff see why it stopped.
export const AUTOPAY_CANCELLED_SHOWN_DAYS = 30

export const LIVE_AUTOPAY_STATUSES = ['ACTIVE', 'NEEDS_ACTION'] as const

export const AUTOPAY_NOT_FOUND = 'Автоплатёж не найден'
export const AUTOPAY_STAFF_REFUSAL =
    'Автоплатежи учеников ведёт только администратор клуба'

// Live agreements plus the ones cancelled in the last 30 days.
export const shownAutopayWhere = (now: Date): Prisma.MemberAutopayWhereInput => ({
    OR: [
        { status: { in: [...LIVE_AUTOPAY_STATUSES] } },
        {
            cancelledAt: {
                gte: new Date(now.getTime() - AUTOPAY_CANCELLED_SHOWN_DAYS * DAY_MS),
            },
        },
    ],
})

export const autopayViewSelect = {
    id: true,
    workspaceId: true,
    userId: true,
    planId: true,
    planName: true,
    status: true,
    needsActionReason: true,
    cardLast4: true,
    termsAmount: true,
    currency: true,
    termsDurationDays: true,
    termsClassCount: true,
    consentVersion: true,
    consentedAt: true,
    failedAttempts: true,
    nextAttemptAt: true,
    lastError: true,
    cancelledAt: true,
    cancelSource: true,
    cancelledById: true,
    cancelReason: true,
    createdAt: true,
    updatedAt: true,
    plan: {
        select: {
            id: true,
            price: true,
            currency: true,
            durationDays: true,
            classCount: true,
            directions: { select: { directionId: true } },
        },
    },
} as const satisfies Prisma.MemberAutopaySelect

export type AutopayViewRow = Prisma.MemberAutopayGetPayload<{
    select: typeof autopayViewSelect
}>

type ViewPlan = NonNullable<AutopayViewRow['plan']>

export type AutopayView = {
    row: AutopayViewRow
    cardLabel: string
    needsActionReason: AutopayNeedsActionReason | null
    cancelSource: AutopayCancelSource | null
    nextCharge: { on: string; amount: number; kind: AutopayDueKind } | null
    newTerms: {
        amount: number
        durationDays: number
        classCount: number | null
        consentVersion: string
    } | null
    lastFailedOn: string | null
    nextAttemptOn: string | null
}

// The stored VarChar columns, narrowed to the contract's enums.
export const asNeedsActionReason = (v: string | null): AutopayNeedsActionReason | null =>
    (AUTOPAY_NEEDS_ACTION_REASONS as readonly string[]).includes(v ?? '')
        ? (v as AutopayNeedsActionReason)
        : null

// The tariff's current terms, when they are less favourable than agreed:
// nothing is charged until the member accepts them.
export const pendingAutopayTerms = (
    row: Pick<
        AutopayViewRow,
        'termsAmount' | 'termsDurationDays' | 'termsClassCount' | 'currency'
    >,
    plan: Pick<ViewPlan, 'durationDays' | 'classCount' | 'currency'>,
    renewal: Pick<AutopayRenewalPrice, 'amount'>,
): AutopayView['newTerms'] =>
    termsCheck(row, plan, renewal.amount) === 'changed'
        ? {
              amount: renewal.amount,
              durationDays: plan.durationDays,
              classCount: plan.classCount,
              consentVersion: AUTOPAY_CONSENT_VERSION,
          }
        : null

// Names of the staff who cancelled (display only, like markedPaidById).
export const loadStaffNames = async (
    prisma: PrismaService,
    views: readonly AutopayView[],
): Promise<Map<string, string>> => {
    const ids = [...new Set(views.flatMap((v) => (v.row.cancelledById ? [v.row.cancelledById] : [])))]
    if (ids.length === 0) return new Map()
    const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstname: true, lastname: true, email: true },
    })
    return new Map(users.map((u) => [u.id, displayName(u)]))
}

// One member's agreements in a club, as their screens read them: the next
// charge (from the member's abonements, the rules of domains/autopay), the
// renewal amount now (family discount included), a pending rise, the last
// decline. Live first, then the cancelled ones, newest first.
export const loadAutopayViews = async (
    prisma: PrismaService,
    p: { workspaceId: string; userId: string; now: Date; id?: string },
): Promise<AutopayView[]> => {
    const rows = await prisma.memberAutopay.findMany({
        where: {
            workspaceId: p.workspaceId,
            userId: p.userId,
            ...(p.id ? { id: p.id } : shownAutopayWhere(p.now)),
        },
        select: autopayViewSelect,
        orderBy: [{ cancelledAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    })
    const live = rows.filter((r) => r.status !== 'CANCELLED')
    if (live.length === 0) return rows.map((row) => toView(row, null))

    const declined = live.filter((r) => r.failedAttempts > 0).map((r) => r.id)
    const [workspace, member, failures] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: p.workspaceId },
            select: { timezone: true },
        }),
        prisma.workspaceMember.findFirst({
            where: { workspaceId: p.workspaceId, userId: p.userId },
            select: { id: true },
        }),
        declined.length > 0
            ? prisma.payment.findMany({
                  where: { autopayId: { in: declined }, status: 'CANCELED' },
                  orderBy: { updatedAt: 'desc' },
                  distinct: ['autopayId'],
                  select: { autopayId: true, updatedAt: true },
              })
            : [],
    ])
    const tz = workspace?.timezone ?? 'UTC'
    const today = localDateInTz(p.now, tz)
    const subs = member
        ? await loadAutopayAbonements(prisma, { workspaceMemberId: member.id, now: p.now })
        : []
    const plans = new Map(live.flatMap((r) => (r.plan ? [[r.plan.id, r.plan] as const] : [])))
    const prices = new Map(
        await Promise.all(
            [...plans.values()].map(
                async (plan) =>
                    [
                        plan.id,
                        await autopayRenewalPrice(prisma, {
                            workspaceId: p.workspaceId,
                            userId: p.userId,
                            plan,
                            now: p.now,
                            today,
                        }),
                    ] as const,
            ),
        ),
    )
    const lastDecline = new Map(failures.map((f) => [f.autopayId, f.updatedAt]))

    return rows.map((row) => {
        if (row.status === 'CANCELLED' || !row.plan) return toView(row, null)
        const renewal = prices.get(row.plan.id)
        const newTerms = renewal ? pendingAutopayTerms(row, row.plan, renewal) : null
        const schedule = autopaySchedule(subs, scopeDirectionIds(row.plan), tz, p.now)
        const retryOn =
            row.status === 'ACTIVE' && row.failedAttempts > 0 && row.nextAttemptAt
                ? localDateInTz(row.nextAttemptAt, tz)
                : null
        const failedAt = row.failedAttempts > 0 ? lastDecline.get(row.id) : undefined
        return toView(row, {
            nextCharge:
                row.status === 'ACTIVE' && !newTerms && renewal && schedule.nextCharge
                    ? {
                          on: retryOn ?? schedule.nextCharge.on,
                          // A lower price is charged; never more than agreed.
                          amount: Math.min(renewal.amount, row.termsAmount),
                          kind: schedule.nextCharge.kind,
                      }
                    : null,
            newTerms,
            lastFailedOn: failedAt ? localDateInTz(failedAt, tz) : null,
            nextAttemptOn: retryOn,
        })
    })
}

const toView = (
    row: AutopayViewRow,
    live: Pick<AutopayView, 'nextCharge' | 'newTerms' | 'lastFailedOn' | 'nextAttemptOn'> | null,
): AutopayView => ({
    row,
    cardLabel: autopayCardLabel(row.cardLast4),
    needsActionReason: asNeedsActionReason(row.needsActionReason),
    cancelSource: (AUTOPAY_CANCEL_SOURCES as readonly string[]).includes(row.cancelSource ?? '')
        ? (row.cancelSource as AutopayCancelSource)
        : null,
    nextCharge: live?.nextCharge ?? null,
    newTerms: live?.newTerms ?? null,
    lastFailedOn: live?.lastFailedOn ?? null,
    nextAttemptOn: live?.nextAttemptOn ?? null,
})
