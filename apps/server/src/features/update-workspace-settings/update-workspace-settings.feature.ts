import { z } from 'zod'

import { FeatureFlagColumnsSchema } from '../../domains/workspace/feature-flags'

export const UpdateWorkspaceSettingsFeatureInputSchema = z.object({
    coachSeesAllGroups: z.boolean().optional(),
    // IANA timezone, validated against Intl.supportedValuesOf in the
    // handler so the schema doesn't have to ship the full list.
    timezone: z.string().min(1).max(64).optional(),
    // «Принимать без подтверждения»: a code join becomes ACTIVE straight away.
    joinAutoApprove: z.boolean().optional(),
    // leaderboardEnabled + the app-section flags — each optional so the admin
    // can PATCH a single toggle.
    ...FeatureFlagColumnsSchema.partial().shape,
})

export const UpdateWorkspaceSettingsFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    coachSeesAllGroups: z.boolean(),
    timezone: z.string(),
    joinAutoApprove: z.boolean(),
    ...FeatureFlagColumnsSchema.shape,
})

export class UpdateWorkspaceSettingsFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdateWorkspaceSettingsFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateWorkspaceSettingsFeatureResponse = z.infer<
    typeof UpdateWorkspaceSettingsFeatureOutputSchema
>
