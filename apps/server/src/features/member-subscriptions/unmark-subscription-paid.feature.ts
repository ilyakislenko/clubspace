import { z } from 'zod'

import { SubscriptionOutputSchema } from './schemas'

export const UnmarkSubscriptionPaidFeatureOutputSchema = z.object({
    subscription: SubscriptionOutputSchema,
})

export class UnmarkSubscriptionPaidFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly subscriptionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UnmarkSubscriptionPaidFeatureResponse = z.infer<
    typeof UnmarkSubscriptionPaidFeatureOutputSchema
>
