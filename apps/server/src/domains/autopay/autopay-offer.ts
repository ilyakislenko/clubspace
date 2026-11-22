import { environment } from '../../environments/environment'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { type PricedSale, priceSale } from '../discounts/discount-rules'
import { resolveAutomaticDiscount } from '../discounts/discounts'

// Autopay may be offered on this tariff: the global switch, the club's
// provider is YooKassa with «Автоплатежи для учеников» on, and the tariff is
// ticked «Можно продлевать автоплатежом» (the caller already knows it is sold
// online).
export const autopayOffered = (
    settings: { provider: string; autopayEnabled: boolean } | null,
    plan: { autopayAvailable: boolean },
): boolean =>
    environment.memberAutopay.enabled &&
    settings?.provider === 'YOOKASSA' &&
    settings.autopayEnabled &&
    plan.autopayAvailable

export type AutopayRenewalPrice = PricedSale & { listPrice: number }

// What a renewal charges (docs/design/2026-11-15-member-autopay.md §2.4): the
// tariff's price with the automatic (family) discount only — never a promo
// code or a staff discount. The consent shows it as «дальше», the agreement
// stores it as termsAmount, and each charge recomputes it.
export const autopayRenewalPrice = async (
    db: Pick<PrismaTransactionClientType, 'discount' | 'guardianship' | 'subscription' | 'workspace'>,
    p: {
        workspaceId: string
        userId: string
        plan: { id: string; price: number; currency: string }
        now: Date
        // The club-local day.
        today: string
    },
): Promise<AutopayRenewalPrice> => {
    const item = {
        planId: p.plan.id,
        eventId: null,
        listPrice: p.plan.price,
        currency: p.plan.currency,
    }
    const family = await resolveAutomaticDiscount(db, {
        workspaceId: p.workspaceId,
        userId: p.userId,
        item,
        now: p.now,
        today: p.today,
    })
    return {
        ...priceSale({ listPrice: p.plan.price, currency: p.plan.currency, discount: family }),
        listPrice: p.plan.price,
    }
}
