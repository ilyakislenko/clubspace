import type { PlatformPricing } from '../../domains/billing/platform-pricing.config'
import { quoteWorkspaceBilling, type QuoteInputs } from '../../domains/billing/quote-workspace-billing'
import type {
    GetPublicPricingFeatureResponse,
    QuotePublicPricingFeature,
    QuotePublicPricingFeatureResponse,
} from './public-pricing.feature'

export const publicPricingView = (
    pricing: PlatformPricing,
    trialDays: number,
): GetPublicPricingFeatureResponse => ({
    currency: pricing.currency,
    trialDays,
    setupFee: pricing.setupFee,
    annualDiscountPercent: pricing.annualDiscountPercent,
    tiers: pricing.tiers.map((t) => ({
        code: t.code,
        name: t.name,
        upTo: t.upTo,
        priceMonthly: t.priceMonthly,
        extraMemberPrice: t.extraMemberPrice,
    })),
    modules: pricing.modules.map((m) => ({
        code: m.code,
        name: m.name,
        priceMonthly: m.priceMonthly,
        includes: [...m.includes],
        includedStorageGb: m.includedStorageGb,
        includedViewHours: m.includedViewHours,
        extraStorageGbPrice: m.extraStorageGbPrice,
        extraViewHourPrice: m.extraViewHourPrice,
    })),
})

// What a new club with this many active members and these modules would pay,
// through the very function that prices a real club — list prices only: no
// custom price, no discount or free period, no usage overage. The first
// payment carries the setup fee; the renewal is the same quote without it.
export const quotePublicPricing = (
    pricing: PlatformPricing,
    payload: QuotePublicPricingFeature['payload'],
    now: Date,
): QuotePublicPricingFeatureResponse => {
    const base: Omit<QuoteInputs, 'setupFee'> = {
        pricing,
        activeMembers: payload.activeMembers,
        periodStart: now,
        periodMonths: payload.periodMonths,
        subscription: {
            customMonthlyPrice: null,
            discountPercent: 0,
            discountUntil: null,
            freeUntil: null,
        },
        modules: [...new Set(payload.modules)].map((code) => ({
            code,
            mode: 'PAID' as const,
            compUntil: null,
            customPrice: null,
        })),
        usage: { storageBytes: 0, viewedSeconds: 0 },
    }
    const quote = quoteWorkspaceBilling({
        ...base,
        setupFee: { waived: false, paid: false },
    })
    const renewal = quoteWorkspaceBilling({
        ...base,
        setupFee: { waived: false, paid: true },
    }).total
    return {
        quote,
        renewal,
        perMonth: Math.round(renewal / quote.periodMonths),
    }
}
