import { z } from 'zod'

import {
    PlatformPlanSchema,
    WorkspaceBillingSummarySchema,
} from './schemas'

export const GetWorkspaceBillingOutputSchema = z.object({
    // false on a self-hosted install: no limits, no expiry — the admin hides
    // the whole page and every billing banner.
    enabled: z.boolean(),
    billing: WorkspaceBillingSummarySchema,
    // Every plan, cheapest first, for the comparison table.
    plans: z.array(PlatformPlanSchema),
    // Days of grace a past-due club keeps working before suspension.
    graceDays: z.number().int(),
})

export class GetWorkspaceBillingFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetWorkspaceBillingFeatureResponse = z.infer<
    typeof GetWorkspaceBillingOutputSchema
>
