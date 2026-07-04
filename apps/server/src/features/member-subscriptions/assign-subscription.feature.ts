import { z } from 'zod'

import { AssignSubscriptionOutputSchema } from './schemas'

export const AssignSubscriptionInputSchema = z.object({
    planId: z.string().uuid(),
    // Wall-clock start date (YYYY-MM-DD); defaults to today. endDate is derived
    // as startDate + plan.durationDays.
    startDate: z.iso.date().optional(),
    // Override the recorded amount (e.g. a discount or comped abonement).
    // Defaults to the plan price.
    amountPaid: z.number().int().min(0).optional(),
})
export const AssignSubscriptionFeatureOutputSchema =
    AssignSubscriptionOutputSchema

export class AssignSubscriptionFeature {
    constructor(
        readonly payload: z.infer<typeof AssignSubscriptionInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type AssignSubscriptionFeatureResponse = z.infer<
    typeof AssignSubscriptionFeatureOutputSchema
>
