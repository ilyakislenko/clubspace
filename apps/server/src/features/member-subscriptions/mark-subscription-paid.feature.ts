import { z } from 'zod'

import { SubscriptionOutputSchema } from './schemas'

export const MarkSubscriptionPaidInputSchema = z.object({
    // What was actually received; omitted keeps the agreed price.
    amount: z.number().int().min(0).max(10_000_000).optional(),
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
