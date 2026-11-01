import { z } from 'zod'

import { APP_FEATURE_KEYS } from '../../domains/workspace/feature-flags'
import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

// The platform owner switches one of a club's app sections (`<key>Enabled`)
// on or off for it — the same column the club's admin toggles in settings.
export const SetPlatformWorkspaceFeatureInputSchema = z.object({
    feature: z.enum(APP_FEATURE_KEYS),
    enabled: z.boolean(),
})

export const SetPlatformWorkspaceFeatureOutputSchema =
    PlatformWorkspaceBillingOutputSchema

export class SetPlatformWorkspaceFeatureFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: z.infer<typeof SetPlatformWorkspaceFeatureInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SetPlatformWorkspaceFeatureFeatureResponse = z.infer<
    typeof SetPlatformWorkspaceFeatureOutputSchema
>
