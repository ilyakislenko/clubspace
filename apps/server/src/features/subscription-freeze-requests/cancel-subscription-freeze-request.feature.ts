import { z } from 'zod'

import { SubscriptionFreezeRequestOutputSchema } from './schemas'

export const CancelSubscriptionFreezeRequestFeatureOutputSchema =
    SubscriptionFreezeRequestOutputSchema

export class CancelSubscriptionFreezeRequestFeature {
    constructor(
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
    ) {}
}
export type CancelSubscriptionFreezeRequestFeatureResponse = z.infer<
    typeof CancelSubscriptionFreezeRequestFeatureOutputSchema
>
