import { z } from 'zod'

import { MAX_FREEZE_DAYS } from '../../domains/subscriptions/freeze-dates'
import { FreezeSubscriptionOutputSchema } from './schemas'

export const FreezeSubscriptionInputSchema = z.object({
    days: z.number().int().min(1).max(MAX_FREEZE_DAYS),
    // Club-local first day of the freeze (YYYY-MM-DD); defaults to today.
    fromDate: z.iso.date().optional(),
    // Shown to the member ("Травма", "Отпуск", …).
    reason: z.string().trim().max(200).optional(),
})
export const FreezeSubscriptionFeatureOutputSchema =
    FreezeSubscriptionOutputSchema

export class FreezeSubscriptionFeature {
    constructor(
        readonly payload: z.infer<typeof FreezeSubscriptionInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly subscriptionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type FreezeSubscriptionFeatureResponse = z.infer<
    typeof FreezeSubscriptionFeatureOutputSchema
>
