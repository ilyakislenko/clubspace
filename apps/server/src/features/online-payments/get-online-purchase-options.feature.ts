import { z } from 'zod'

import { MyPaymentOutputSchema, PaymentProviderSchema } from './schemas'

export const OnlinePlanOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    price: z.number().int(),
    currency: z.string(),
    durationDays: z.number().int(),
    classCount: z.number().int().nullable(),
    // Per-direction tariff (only that direction's classes); null = club-wide.
    directionId: z.string().uuid().nullable(),
})

export const GetOnlinePurchaseOptionsOutputSchema = z.object({
    // The club takes online payments and sells at least one tariff online.
    available: z.boolean(),
    provider: PaymentProviderSchema.nullable(),
    plans: z.array(OnlinePlanOutputSchema),
    // Why buying is not possible right now (e.g. classes left in the current
    // pack); null when it is.
    blockedReason: z.string().nullable(),
    // Club-local day a purchase starts on when it renews a live abonement.
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
