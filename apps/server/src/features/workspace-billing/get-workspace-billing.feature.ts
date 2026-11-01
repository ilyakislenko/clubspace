import { z } from 'zod'

import { ClubLegalViewSchema } from '../club-legal/schemas'
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
    // The offer + DPA editions and the club's acceptance of them (the
    // owner's banner and the «Договор» block of the page).
    legal: ClubLegalViewSchema,
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
