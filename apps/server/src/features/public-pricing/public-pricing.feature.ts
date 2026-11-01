import { z } from 'zod'

import {
    PlatformModuleCodeSchema,
    PlatformTierSchema,
    WorkspaceQuoteSchema,
} from '../workspace-billing/schemas'

// The public price list on the landing (app.<domain>/): the same billing
// config every club's quote is computed from (PLATFORM_PLANS / _MODULES /
// _ANNUAL_DISCOUNT_PERCENT / _SETUP_FEE / _TRIAL_DAYS), so a price changes
// with an env change and a restart, not a release. Nothing about any club.

// GET /public/pricing
export const GetPublicPricingOutputSchema = z.object({
    currency: z.string(),
    trialDays: z.number().int(),
    // Charged once, with the first paid period.
    setupFee: z.number().int(),
    // Off the recurring lines for a 12-month prepay.
    annualDiscountPercent: z.number().int(),
    tiers: z.array(PlatformTierSchema),
    modules: z.array(
        z.object({
            code: PlatformModuleCodeSchema,
            name: z.string(),
            priceMonthly: z.number().int(),
            includes: z.array(z.string()),
            includedStorageGb: z.number().int(),
            includedViewHours: z.number().int(),
            extraStorageGbPrice: z.number().int(),
            extraViewHourPrice: z.number().int(),
        }),
    ),
})
export class GetPublicPricingFeature {}
export type GetPublicPricingFeatureResponse = z.infer<
    typeof GetPublicPricingOutputSchema
>

// POST /public/pricing/quote — the landing's calculator. A body, not a query:
// the module list is an array.
export const QuotePublicPricingInputSchema = z.object({
    activeMembers: z.number().int().min(0).max(100_000),
    modules: z.array(PlatformModuleCodeSchema).max(10).default([]),
    periodMonths: z
        .number()
        .int()
        .refine((v) => v === 1 || v === 12, 'Период оплаты — 1 или 12 месяцев'),
})
export const QuotePublicPricingOutputSchema = z.object({
    // The first payment after the trial: the period plus the setup fee.
    quote: WorkspaceQuoteSchema,
    // Each following period (no setup fee).
    renewal: z.number().int(),
    // renewal / periodMonths, rounded — «в месяц» for an annual prepay.
    perMonth: z.number().int(),
})
export class QuotePublicPricingFeature {
    constructor(
        readonly payload: z.infer<typeof QuotePublicPricingInputSchema>,
    ) {}
}
export type QuotePublicPricingFeatureResponse = z.infer<
    typeof QuotePublicPricingOutputSchema
>
