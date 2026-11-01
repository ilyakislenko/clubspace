import { z } from 'zod'

import { PlatformTierSchema, WorkspaceBillingViewSchema } from './schemas'

export const GetWorkspaceBillingOutputSchema = z.object({
    // false on a self-hosted install: every module on, no expiry — the admin
    // hides the whole page and every billing banner.
    enabled: z.boolean(),
    billing: WorkspaceBillingViewSchema,
    // Every tier, smallest first, for the price table.
    tiers: z.array(PlatformTierSchema),
    annualDiscountPercent: z.number().int(),
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
