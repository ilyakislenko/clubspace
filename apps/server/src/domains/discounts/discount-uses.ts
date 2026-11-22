// A «use» of a discount (docs/design/2026-11-15-discounts.md §3.1): a sale row
// carrying it, except an unpaid sale later cancelled. Refunds don't give a use
// back. Online checks also count the checkouts still open with it (a PENDING
// Payment within the reuse window), except the caller's own reused one.
import { PENDING_REUSE_MS } from '../../features/online-payments/load-buyer'
import type { Prisma, PrismaTransactionClientType } from '../../infrastructure/prisma'

type Db = Pick<PrismaTransactionClientType, 'subscription' | 'eventRegistration' | 'payment'>

// Unpaid and cancelled = never happened.
const NOT_CANCELLED_UNPAID = { NOT: { status: 'CANCELLED', isPaid: false } } as const

export const discountUseSubscriptionWhere = (
    discountIds: string | readonly string[],
    userId?: string,
): Prisma.SubscriptionWhereInput => ({
    discountId: typeof discountIds === 'string' ? discountIds : { in: [...discountIds] },
    ...NOT_CANCELLED_UNPAID,
    ...(userId ? { userId } : {}),
})

export const discountUseTicketWhere = (
    discountIds: string | readonly string[],
    userId?: string,
): Prisma.EventRegistrationWhereInput => ({
    discountId: typeof discountIds === 'string' ? discountIds : { in: [...discountIds] },
    ...NOT_CANCELLED_UNPAID,
    ...(userId ? { userId } : {}),
})

// One count per table, on the discountId indexes. `pending`: count the open
// online checkouts too (online checks), skipping `excludePaymentId` (the
// caller's own payment being reused).
export const countDiscountUses = async (
    db: Db,
    discountId: string,
    opts: {
        userId?: string
        includePending?: { now: Date; excludePaymentId?: string }
    } = {},
): Promise<number> => {
    const pending = opts.includePending
    const [subs, tickets, payments] = await Promise.all([
        db.subscription.count({ where: discountUseSubscriptionWhere(discountId, opts.userId) }),
        db.eventRegistration.count({ where: discountUseTicketWhere(discountId, opts.userId) }),
        pending
            ? db.payment.count({
                  where: {
                      discountId,
                      status: 'PENDING',
                      createdAt: { gte: new Date(pending.now.getTime() - PENDING_REUSE_MS) },
                      ...(opts.userId ? { userId: opts.userId } : {}),
                      ...(pending.excludePaymentId ? { NOT: { id: pending.excludePaymentId } } : {}),
                  },
              })
            : 0,
    ])
    return subs + tickets + payments
}

// Uses of many discounts at once (lists): discountId → count, without pending
// checkouts. `userId`: only that member's uses.
export const countUsesByDiscount = async (
    db: Pick<PrismaTransactionClientType, 'subscription' | 'eventRegistration'>,
    discountIds: readonly string[],
    userId?: string,
): Promise<Map<string, number>> => {
    const out = new Map<string, number>()
    if (discountIds.length === 0) return out
    const [subs, tickets] = await Promise.all([
        db.subscription.groupBy({
            by: ['discountId'],
            where: discountUseSubscriptionWhere(discountIds, userId),
            _count: { _all: true },
        }),
        db.eventRegistration.groupBy({
            by: ['discountId'],
            where: discountUseTicketWhere(discountIds, userId),
            _count: { _all: true },
        }),
    ])
    for (const row of [...subs, ...tickets]) {
        if (!row.discountId) continue
        out.set(row.discountId, (out.get(row.discountId) ?? 0) + row._count._all)
    }
    return out
}
