import { z } from 'zod'

import { addDays } from '../../domains/billing/billing-rules'
import { PLATFORM_MODULE_CODES } from '../../domains/billing/platform-pricing.config'
import type {
    WorkspaceBillingRow,
    WorkspaceBillingState,
} from '../../domains/billing/services/platform-billing.service'
import type { PlatformTier } from '../../domains/billing/platform-pricing.config'

// Platform billing shapes shared by the club's own «Тариф» page and the
// platform console. Whole rubles throughout.

export const WorkspaceBillingStatusSchema = z.enum([
    'TRIAL',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
])

export const PlatformModuleCodeSchema = z.enum(PLATFORM_MODULE_CODES)
export const PlatformModuleModeSchema = z.enum(['PAID', 'COMP', 'OFF'])

export const PlatformTierSchema = z.object({
    code: z.string(),
    name: z.string(),
    // Most active members covered; null = the open-ended top tier.
    upTo: z.number().int().nullable(),
    priceMonthly: z.number().int(),
    // Per active member above the previous tier's upTo.
    extraMemberPrice: z.number().int(),
})

const TierRefSchema = z.object({
    code: z.string(),
    name: z.string(),
    upTo: z.number().int().nullable(),
})

export const QuoteLineSchema = z.object({
    code: z.string(),
    title: z.string(),
    amount: z.number().int(),
})

export const WorkspaceQuoteSchema = z.object({
    lines: z.array(QuoteLineSchema),
    subtotal: z.number().int(),
    discount: z.number().int(),
    discounts: z.array(QuoteLineSchema),
    total: z.number().int(),
    currency: z.string(),
    periodMonths: z.number().int(),
    tierCode: z.string(),
})

export const BillingModuleSchema = z.object({
    code: PlatformModuleCodeSchema,
    name: z.string(),
    // What the club pays per month (the platform's custom price, if any).
    priceMonthly: z.number().int(),
    defaultPriceMonthly: z.number().int(),
    includes: z.array(z.string()),
    // The platform's setting; null = default (on in the trial, off after).
    mode: PlatformModuleModeSchema.nullable(),
    compUntil: z.iso.datetime().nullable(),
    customPrice: z.number().int().nullable(),
    entitled: z.boolean(),
    source: z.enum(['PAID', 'COMP', 'TRIAL', 'OFF', 'NONE', 'SELF_HOSTED']),
})

export const VideoUsageSchema = z.object({
    storageBytes: z.number().int(),
    includedStorageGb: z.number().int(),
    viewedSecondsThisMonth: z.number().int(),
    includedViewHours: z.number().int(),
})

// One row of the platform console list: where the club stands.
export const WorkspaceBillingSummarySchema = z.object({
    status: WorkspaceBillingStatusSchema,
    trialEndsAt: z.iso.datetime().nullable(),
    currentPeriodEnd: z.iso.datetime().nullable(),
    pastDueSince: z.iso.datetime().nullable(),
    // When a PAST_DUE club will be suspended (pastDueSince + grace).
    suspendsAt: z.iso.datetime().nullable(),
    freeUntil: z.iso.datetime().nullable(),
    // Students active in the last 30 days (attended or opened the club).
    activeMembers: z.number().int(),
    tier: TierRefSchema,
})

// The full picture for one club: the billing page and the console card.
export const WorkspaceBillingViewSchema = WorkspaceBillingSummarySchema.extend({
    billingPeriodMonths: z.number().int(),
    nextChargeAt: z.iso.datetime().nullable(),
    // The next tier up (null on the top tier) — for «approaching the limit».
    nextTier: TierRefSchema.nullable(),
    // The tier of the last recorded payment — for «you outgrew it».
    paidTier: TierRefSchema.nullable(),
    modules: z.array(BillingModuleSchema),
    videoUsage: VideoUsageSchema,
    setupFee: z.object({
        amount: z.number().int(),
        waived: z.boolean(),
        paidAt: z.iso.datetime().nullable(),
    }),
    // What the next charge will be.
    quote: WorkspaceQuoteSchema,
})

export type WorkspaceBillingSummary = z.infer<typeof WorkspaceBillingSummarySchema>
export type WorkspaceBillingView = z.infer<typeof WorkspaceBillingViewSchema>

const iso = (d: Date | null) => d?.toISOString() ?? null

const tierRef = (tier: PlatformTier) => ({
    code: tier.code,
    name: tier.name,
    upTo: tier.upTo,
})

export const serializePlatformTier = (tier: PlatformTier) => ({
    ...tierRef(tier),
    priceMonthly: tier.priceMonthly,
    extraMemberPrice: tier.extraMemberPrice,
})

export const serializeBillingSummary = (
    row: WorkspaceBillingRow,
    activeMembers: number,
    tier: PlatformTier,
    graceDays: number,
): WorkspaceBillingSummary => ({
    status: row.status,
    trialEndsAt: iso(row.trialEndsAt),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    pastDueSince: iso(row.pastDueSince),
    suspendsAt:
        row.status === 'PAST_DUE' && row.pastDueSince
            ? addDays(row.pastDueSince, graceDays).toISOString()
            : null,
    freeUntil: iso(row.freeUntil),
    activeMembers,
    tier: tierRef(tier),
})

export const serializeBillingView = (
    state: WorkspaceBillingState,
    graceDays: number,
    setupFee: number,
): WorkspaceBillingView => {
    const video = state.modules.find((m) => m.pricing.code === 'VIDEO')!
    return {
        ...serializeBillingSummary(
            state.row,
            state.activeMembers,
            state.tier,
            graceDays,
        ),
        billingPeriodMonths: state.row.billingPeriodMonths,
        nextChargeAt: iso(state.nextChargeAt),
        nextTier: state.nextTier ? tierRef(state.nextTier) : null,
        paidTier: state.paidTier ? tierRef(state.paidTier) : null,
        modules: state.modules.map((m) => ({
            code: m.pricing.code,
            name: m.pricing.name,
            priceMonthly: m.customPrice ?? m.pricing.priceMonthly,
            defaultPriceMonthly: m.pricing.priceMonthly,
            includes: m.pricing.includes,
            mode: m.mode,
            compUntil: iso(m.compUntil),
            customPrice: m.customPrice,
            entitled: m.entitled,
            source: m.source,
        })),
        videoUsage: {
            storageBytes: state.storageBytes,
            includedStorageGb: video.pricing.includedStorageGb,
            viewedSecondsThisMonth: state.viewedSecondsThisMonth,
            includedViewHours: video.pricing.includedViewHours,
        },
        setupFee: {
            amount: setupFee,
            waived: state.row.setupFeeWaived,
            paidAt: iso(state.row.setupFeePaidAt),
        },
        quote: state.quote,
    }
}
