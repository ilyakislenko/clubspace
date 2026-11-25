import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'
import {
    AutopayOfferOutputSchema,
    MyPaymentOutputSchema,
    PaymentProviderSchema,
} from './schemas'

export const OnlinePlanOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.number().int(),
    // What this member pays now: the price with the family discount when it
    // applies (docs/design/2026-11-15-discounts.md §3.3), else the price. A
    // promo code is quoted by get-checkout-quote.
    amount: z.number().int(),
    // The discount in `amount` (null: none).
    discountName: z.string().nullable(),
    currency: z.string(),
    durationDays: z.number().int(),
    classCount: z.number().int().nullable(),
    // Directions an abonement of this tariff may be spent on; empty = club-wide.
    directions: z.array(DirectionRefSchema),
    // «Продлевать автоматически» may be offered: the club and the tariff allow
    // autopay (YooKassa) and the member has no ACTIVE agreement on it. The
    // consent's «сейчас» is `amount`; with a promo code the checkout quote
    // carries the offer at the quoted price. Always null in a child's profile
    // (docs/design/2026-11-26-parent-pays-for-child.md §10).
    autopay: AutopayOfferOutputSchema.nullable(),
})

export const GetOnlinePurchaseOptionsOutputSchema = z.object({
    // The club takes online payments and sells at least one tariff online.
    available: z.boolean(),
    provider: PaymentProviderSchema.nullable(),
    plans: z.array(OnlinePlanOutputSchema),
    // Why buying is not possible right now (e.g. classes left in the current
    // pack) — set only when no offered tariff can be bought; null otherwise.
    blockedReason: z.string().nullable(),
    // Club-local day a purchase starts on when it renews a live abonement of
    // the same directions (set when every buyable tariff renews from that day).
    renewalFrom: z.iso.date().nullable(),
    // The member's latest payment still waiting for the provider (under
    // X-Act-As: the one this guardian started).
    pendingPayment: MyPaymentOutputSchema.nullable(),
    // The public «Условия автоплатежа» page, set when a tariff offers autopay.
    autopayTermsUrl: z.string().nullable(),
})

export class GetOnlinePurchaseOptionsFeature {
    constructor(
        readonly workspaceId: string,
        // The holder (the child under X-Act-As).
        readonly userId: string,
        // Who is looking (the guardian under X-Act-As): autopay is hidden
        // for a child and the pending payment is this payer's.
        readonly actorUserId: string,
    ) {}
}
export type GetOnlinePurchaseOptionsFeatureResponse = z.infer<
    typeof GetOnlinePurchaseOptionsOutputSchema
>
