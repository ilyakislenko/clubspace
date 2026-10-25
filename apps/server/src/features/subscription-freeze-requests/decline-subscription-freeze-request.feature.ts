import { z } from 'zod'

import { SubscriptionFreezeRequestOutputSchema } from './schemas'

export const DeclineSubscriptionFreezeRequestInputSchema = z.object({
    // Shown to the member.
    comment: z.string().trim().max(500).optional(),
})
export const DeclineSubscriptionFreezeRequestFeatureOutputSchema =
    SubscriptionFreezeRequestOutputSchema

export class DeclineSubscriptionFreezeRequestFeature {
    constructor(
        readonly payload: z.infer<
            typeof DeclineSubscriptionFreezeRequestInputSchema
        >,
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeclineSubscriptionFreezeRequestFeatureResponse = z.infer<
    typeof DeclineSubscriptionFreezeRequestFeatureOutputSchema
>
