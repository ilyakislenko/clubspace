import { z } from 'zod'

import { EndSubscriptionFreezeOutputSchema } from './schemas'

export const EndSubscriptionFreezeFeatureOutputSchema =
    EndSubscriptionFreezeOutputSchema

export class EndSubscriptionFreezeFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly subscriptionId: string,
        readonly freezeId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type EndSubscriptionFreezeFeatureResponse = z.infer<
    typeof EndSubscriptionFreezeFeatureOutputSchema
>
