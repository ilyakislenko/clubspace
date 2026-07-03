import { z } from 'zod'

import { SubscriptionOutputSchema } from './schemas'

export const CancelSubscriptionOutputSchema = SubscriptionOutputSchema

export class CancelSubscriptionFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly subscriptionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CancelSubscriptionFeatureResponse = z.infer<
    typeof CancelSubscriptionOutputSchema
>
