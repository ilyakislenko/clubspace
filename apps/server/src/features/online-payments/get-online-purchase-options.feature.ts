import { z } from 'zod'

import { DirectionRefSchema } from '../../domains/directions/direction-ref'
import { MyPaymentOutputSchema, PaymentProviderSchema } from './schemas'

export const OnlinePlanOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.number().int(),
    currency: z.string(),
    durationDays: z.number().int(),
    classCount: z.number().int().nullable(),
    // Directions an abonement of this tariff may be spent on; empty = club-wide.
    directions: z.array(DirectionRefSchema),
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
    // The member's latest payment still waiting for the provider.
    pendingPayment: MyPaymentOutputSchema.nullable(),
})

export class GetOnlinePurchaseOptionsFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}
export type GetOnlinePurchaseOptionsFeatureResponse = z.infer<
    typeof GetOnlinePurchaseOptionsOutputSchema
>
