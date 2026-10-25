import { z } from 'zod'

import { MAX_FREEZE_DAYS } from '../../domains/subscriptions/freeze-dates'
import { SubscriptionFreezeRequestOutputSchema } from './schemas'

export const RequestSubscriptionFreezeInputSchema = z.object({
    // Club-local first day of the freeze (YYYY-MM-DD).
    fromDate: z.iso.date(),
    days: z.number().int().min(1).max(MAX_FREEZE_DAYS),
    // Required: the coach decides on it.
    reason: z.string().trim().min(1).max(200),
})
export const RequestSubscriptionFreezeFeatureOutputSchema =
    SubscriptionFreezeRequestOutputSchema

export class RequestSubscriptionFreezeFeature {
    constructor(
        readonly payload: z.infer<typeof RequestSubscriptionFreezeInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}
export type RequestSubscriptionFreezeFeatureResponse = z.infer<
    typeof RequestSubscriptionFreezeFeatureOutputSchema
>
