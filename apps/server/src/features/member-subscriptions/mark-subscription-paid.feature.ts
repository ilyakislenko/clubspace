import { z } from 'zod'

import { ClubPaymentMethodSchema } from '../../shared/utils/payment-method'
import { SubscriptionOutputSchema } from './schemas'

export const MarkSubscriptionPaidInputSchema = z.object({
    // What was actually received; omitted keeps the agreed price (with the
    // discount picked below). A changed amount is recorded as a one-off
    // discount with who changed it (pricedById).
    amount: z.number().int().min(0).max(10_000_000).optional(),
    // A club discount picked now (listSaleDiscounts) — only for a sale without
    // one that has a recorded tariff price; it reprices from that price.
    discountId: z.string().uuid().optional(),
    // Cash, a transfer or a card on the club's terminal; omitted = not
    // recorded («не указано»).
    method: ClubPaymentMethodSchema.optional(),
})
export const MarkSubscriptionPaidFeatureOutputSchema = z.object({
    subscription: SubscriptionOutputSchema,
})

export class MarkSubscriptionPaidFeature {
    constructor(
        readonly payload: z.infer<typeof MarkSubscriptionPaidInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly subscriptionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type MarkSubscriptionPaidFeatureResponse = z.infer<
    typeof MarkSubscriptionPaidFeatureOutputSchema
>
