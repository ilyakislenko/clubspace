// «Кто давал скидки» (docs/design/2026-11-15-discounts.md §3.2): paid sales
// in the period (by paidAt) priced by staff (pricedById set; online sales have
// none), split per §1 into the one-off part (typed amounts) and the named part
// (picked from the list), per person and currency.
import { saleDiscount } from '../../domains/discounts/discount-rules'
import { FORMER_STAFF_NAME, loadPricedByNames } from '../../domains/discounts/priced-by'
import type { JournalRange } from '../../domains/payments/journal'
import type { PrismaService } from '../../infrastructure/prisma'
import type { DiscountStaffSummary } from './schemas'

export const STAFF_SUMMARY_LIMIT = 50

export type PricedSaleRow = {
    pricedById: string | null
    listPrice: number | null
    amountPaid: number | null
    discountAmount: number
    discountId: string | null
    currency: string | null
}

export const summarizeStaffDiscounts = (
    rows: readonly PricedSaleRow[],
    names: ReadonlyMap<string, string>,
): DiscountStaffSummary[] => {
    const byKey = new Map<string, DiscountStaffSummary>()
    for (const r of rows) {
        if (!r.pricedById || !r.currency) continue
        const { named, oneOff } = saleDiscount(r)
        if (named === 0 && oneOff === 0) continue
        const key = `${r.pricedById}:${r.currency}`
        const entry = byKey.get(key) ?? {
            userId: r.pricedById,
            name: names.get(r.pricedById) ?? FORMER_STAFF_NAME,
            currency: r.currency,
            oneOff: { count: 0, amount: 0 },
            named: { count: 0, amount: 0 },
        }
        if (oneOff > 0) {
            entry.oneOff.count += 1
            entry.oneOff.amount += oneOff
        }
        if (r.discountId && named > 0) {
            entry.named.count += 1
            entry.named.amount += named
        }
        byKey.set(key, entry)
    }
    return [...byKey.values()]
        .sort(
            (a, b) =>
                b.oneOff.amount - a.oneOff.amount ||
                b.named.amount - a.named.amount ||
                a.name.localeCompare(b.name, 'ru'),
        )
        .slice(0, STAFF_SUMMARY_LIMIT)
}

const pricedSaleSelect = {
    pricedById: true,
    listPrice: true,
    amountPaid: true,
    discountAmount: true,
    discountId: true,
    currency: true,
} as const

export const loadStaffDiscountSummary = async (
    prisma: PrismaService,
    workspaceId: string,
    range: JournalRange,
): Promise<DiscountStaffSummary[]> => {
    const where = {
        workspaceId,
        isPaid: true,
        paidAt: range,
        pricedById: { not: null },
        listPrice: { not: null },
    }
    const [subs, tickets] = await Promise.all([
        prisma.subscription.findMany({ where, select: pricedSaleSelect }),
        prisma.eventRegistration.findMany({ where, select: pricedSaleSelect }),
    ])
    const rows: PricedSaleRow[] = [...subs, ...tickets]
    const names = await loadPricedByNames(prisma, rows)
    return summarizeStaffDiscounts(rows, names)
}
