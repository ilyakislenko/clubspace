import { z } from 'zod'

import { MAX_FREEZE_DAYS } from '../../domains/subscriptions/freeze-dates'
import { SubscriptionFreezeOutputSchema } from '../member-subscriptions/schemas'
import { SubscriptionFreezeRequestOutputSchema } from './schemas'

// Every field overrides what the member asked for.
export const ApproveSubscriptionFreezeRequestInputSchema = z.object({
    fromDate: z.iso.date().optional(),
    days: z.number().int().min(1).max(MAX_FREEZE_DAYS).optional(),
    reason: z.string().trim().max(200).optional(),
})
export const ApproveSubscriptionFreezeRequestFeatureOutputSchema = z.object({
    request: SubscriptionFreezeRequestOutputSchema,
    freeze: SubscriptionFreezeOutputSchema,
})

export class ApproveSubscriptionFreezeRequestFeature {
    constructor(
        readonly payload: z.infer<
            typeof ApproveSubscriptionFreezeRequestInputSchema
        >,
        readonly workspaceId: string,
        readonly requestId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ApproveSubscriptionFreezeRequestFeatureResponse = z.infer<
    typeof ApproveSubscriptionFreezeRequestFeatureOutputSchema
>
