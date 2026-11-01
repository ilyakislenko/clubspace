import { z } from 'zod'

import { addDays } from '../../domains/billing/billing-rules'
import {
    BILLING_PROMO_KINDS,
    type BillingPromo,
} from '../../domains/billing/billing-promos'
import { PLATFORM_MODULE_CODES } from '../../domains/billing/platform-pricing.config'
import type {
    WorkspaceBillingRow,
    WorkspaceBillingState,
} from '../../domains/billing/services/platform-billing.service'
import type { PlatformTier } from '../../domains/billing/platform-pricing.config'
import type { PlatformPayment } from '../../infrastructure/prisma'

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
    // The club disconnected it: on (and on the bill) until this moment.
    cancelAt: z.iso.datetime().nullable(),
    // What connecting it now charges (the rest of the paid period); null =
    // free now and on the next bill, or not connectable.
    connectPrice: z.number().int().nullable(),
})

// The saved card and automatic renewal.
export const BillingAutopaySchema = z.object({
    // The platform's shop is configured: card payments are possible at all.
    available: z.boolean(),
    // Automatic renewal is on (the platform can switch it off for a club).
    enabled: z.boolean(),
    card: z
        .object({
            title: z.string().nullable(),
            last4: z.string().nullable(),
            savedAt: z.iso.datetime().nullable(),
        })
        .nullable(),
    // Refused renewals in a row, when the next try is, and why the last failed.
    failedAttempts: z.number().int(),
    nextAttemptAt: z.iso.datetime().nullable(),
    lastError: z.string().nullable(),
})

export const VideoUsageSchema = z.object({
    storageBytes: z.number().int(),
    includedStorageGb: z.number().int(),
    viewedSecondsThisMonth: z.number().int(),
    includedViewHours: z.number().int(),
})

// A promo running for the club: a free period, a discount, a module granted
// free, the setup fee waived. `until` null = until the platform lifts it.
export const BillingPromoSchema = z.object({
    kind: z.enum(BILLING_PROMO_KINDS),
    title: z.string(),
    until: z.iso.datetime().nullable(),
})

export const serializeBillingPromo = (p: BillingPromo) => ({
    kind: p.kind,
    title: p.title,
    until: p.until?.toISOString() ?? null,
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
    // What paying by card now charges for a month / a year, for the period
    // starting at periodStart.
    checkout: z.object({
        periodStart: z.iso.datetime(),
        monthly: WorkspaceQuoteSchema,
        annual: WorkspaceQuoteSchema,
    }),
    autopay: BillingAutopaySchema,
    // Promos running now, with their end dates.
    promos: z.array(BillingPromoSchema),
})

export const PlatformPaymentStatusSchema = z.enum([
    'PENDING',
    'SUCCEEDED',
    'CANCELED',
    'REFUNDED',
])

// One payment from the club to ClubSpace, for the history on the club page
// and in the console.
export const PlatformPaymentSchema = z.object({
    id: z.string().uuid(),
    kind: z.enum(['PERIOD', 'MODULE']),
    initiator: z.enum(['OWNER', 'AUTOPAY', 'PLATFORM']),
    module: PlatformModuleCodeSchema.nullable(),
    status: PlatformPaymentStatusSchema,
    amount: z.number().int(),
    refundedAmount: z.number().int(),
    currency: z.string(),
    periodMonths: z.number().int(),
    periodStart: z.iso.datetime().nullable(),
    periodEnd: z.iso.datetime().nullable(),
    // The quote as charged.
    lines: z.array(QuoteLineSchema),
    discounts: z.array(QuoteLineSchema),
    cardLast4: z.string().nullable(),
    cardTitle: z.string().nullable(),
    // Where YooKassa sent the 54-ФЗ receipt (null for a free renewal).
    receiptEmail: z.string().nullable(),
    failureReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    paidAt: z.iso.datetime().nullable(),
    refundedAt: z.iso.datetime().nullable(),
})

export type PlatformPaymentDto = z.infer<typeof PlatformPaymentSchema>

export const PlatformPaymentListSchema = z.object({
    data: z.array(PlatformPaymentSchema),
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
            cancelAt: iso(m.cancelAt),
            connectPrice: m.connectPrice,
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
        checkout: {
            periodStart: state.checkoutPeriodStart.toISOString(),
            monthly: state.checkoutQuotes.monthly,
            annual: state.checkoutQuotes.annual,
        },
        autopay: serializeAutopay(state.row, state.autopayAvailable),
        promos: state.promos.map(serializeBillingPromo),
    }
}

export const serializeAutopay = (
    row: WorkspaceBillingRow,
    available: boolean,
): z.infer<typeof BillingAutopaySchema> => ({
    available,
    enabled: row.autopayEnabled ?? true,
    card: row.paymentMethodId
        ? {
              title: row.paymentMethodTitle ?? null,
              last4: row.paymentMethodCardLast4 ?? null,
              savedAt: iso(row.paymentMethodSavedAt ?? null),
          }
        : null,
    failedAttempts: row.autopayFailedAttempts ?? 0,
    nextAttemptAt: iso(row.autopayNextAttemptAt ?? null),
    lastError: row.autopayLastError ?? null,
})

const QuoteLinesJsonSchema = z.object({
    lines: z.array(QuoteLineSchema).catch([]),
    discounts: z.array(QuoteLineSchema).catch([]),
})

export const serializePlatformPayment = (p: PlatformPayment): PlatformPaymentDto => {
    const lines = QuoteLinesJsonSchema.safeParse(p.lines)
    return {
        id: p.id,
        kind: p.kind,
        initiator: p.initiator,
        module: p.module,
        status: p.status,
        amount: p.amount,
        refundedAmount: p.refundedAmount,
        currency: p.currency,
        periodMonths: p.periodMonths,
        periodStart: iso(p.periodStart),
        periodEnd: iso(p.periodEnd),
        lines: lines.success ? lines.data.lines : [],
        discounts: lines.success ? lines.data.discounts : [],
        cardLast4: p.cardLast4,
        cardTitle: p.cardTitle,
        receiptEmail: p.receiptEmail,
        failureReason: p.failureReason,
        createdAt: p.createdAt.toISOString(),
        paidAt: iso(p.paidAt),
        refundedAt: iso(p.refundedAt),
    }
}
