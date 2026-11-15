// Reads and checks shared by the discount endpoints: usage stats, the club's
// day, the uniqueness rules a write must pass.
import { saleDiscount } from '../../domains/discounts/discount-rules'
import { countUsesByDiscount } from '../../domains/discounts/discount-uses'
import { localDateInTz } from '../attendance/attendance-utils'
import type { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { familyTakenMessage, NAME_TAKEN_MESSAGE } from './schemas'

export type DiscountStats = {
    uses: number
    given: Array<{ currency: string; amount: number }>
}

// Uses (§3.1, no pending checkouts) and Σ of each discount's named part over
// its paid sales per currency (refunds ignored), for many discounts at once.
// The part is §1's `saleDiscount(...).named` — capped at the sale's total
// discount like the journal, «Кто давал скидки» and the AI report — so a sale
// paid at or above its list price gives nothing.
export const loadDiscountStats = async (
    prisma: PrismaService,
    discountIds: readonly string[],
): Promise<Map<string, DiscountStats>> => {
    const out = new Map<string, DiscountStats>(
        discountIds.map((id) => [id, { uses: 0, given: [] }]),
    )
    if (discountIds.length === 0) return out
    const ids = [...discountIds]
    const paidSales = {
        where: { discountId: { in: ids }, isPaid: true },
        select: { discountId: true, currency: true, listPrice: true, amountPaid: true, discountAmount: true },
    } as const
    const [uses, subs, tickets] = await Promise.all([
        countUsesByDiscount(prisma, ids),
        prisma.subscription.findMany(paidSales),
        prisma.eventRegistration.findMany(paidSales),
    ])
    for (const [id, n] of uses) {
        const stats = out.get(id)
        if (stats) stats.uses = n
    }
    for (const row of [...subs, ...tickets]) {
        const stats = row.discountId ? out.get(row.discountId) : undefined
        const amount = saleDiscount(row).named
        if (!stats || !row.currency || amount === 0) continue
        const bucket = stats.given.find((g) => g.currency === row.currency)
        if (bucket) bucket.amount += amount
        else stats.given.push({ currency: row.currency, amount })
    }
    for (const stats of out.values()) stats.given.sort((a, b) => b.amount - a.amount)
    return out
}

export const loadClubToday = async (
    prisma: PrismaService,
    workspaceId: string,
    now: Date,
): Promise<{ today: string; timezone: string }> => {
    const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { timezone: true },
    })
    const timezone = ws?.timezone ?? 'UTC'
    return { today: localDateInTz(now, timezone), timezone }
}

// A write that leaves the discount active: its name is unique among the
// club's active discounts, and a family one is the club's only active one.
export const assertActiveDiscountFree = async (
    prisma: PrismaService,
    p: {
        workspaceId: string
        exceptId: string | null
        name: string | null
        isFamily: boolean
    },
): Promise<void> => {
    const notSelf = p.exceptId ? { NOT: { id: p.exceptId } } : {}
    const [sameName, family] = await Promise.all([
        p.name
            ? prisma.discount.findFirst({
                  where: {
                      workspaceId: p.workspaceId,
                      isActive: true,
                      name: { equals: p.name, mode: 'insensitive' },
                      ...notSelf,
                  },
                  select: { id: true },
              })
            : null,
        p.isFamily
            ? prisma.discount.findFirst({
                  where: { workspaceId: p.workspaceId, isActive: true, isFamily: true, ...notSelf },
                  select: { name: true },
              })
            : null,
    ])
    if (sameName) throw new BadRequestError({ message: NAME_TAKEN_MESSAGE })
    if (family) throw new BadRequestError({ message: familyTakenMessage(family.name) })
}

// The scope's tariffs must be the club's; a foreign id is a 404.
export const assertPlansInWorkspace = async (
    prisma: PrismaService,
    workspaceId: string,
    planIds: readonly string[],
): Promise<string[]> => {
    const unique = [...new Set(planIds)]
    if (unique.length === 0) return []
    const found = await prisma.plan.count({ where: { id: { in: unique }, workspaceId } })
    if (found !== unique.length) throw new NotFoundError({ message: 'Тариф не найден' })
    return unique
}

export const isUniqueViolation = (e: unknown): boolean =>
    (e as { code?: string } | null)?.code === 'P2002'
