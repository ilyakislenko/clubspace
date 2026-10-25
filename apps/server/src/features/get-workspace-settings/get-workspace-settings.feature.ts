import { z } from 'zod'

import { FeatureFlagColumnsSchema } from '../../domains/workspace/feature-flags'

export const GetWorkspaceSettingsFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    coachSeesAllGroups: z.boolean(),
    timezone: z.string(),
    joinAutoApprove: z.boolean(),
    // leaderboardEnabled + the app-section flags all live here now.
    ...FeatureFlagColumnsSchema.shape,
})

export class GetWorkspaceSettingsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceSettingsFeatureResponse = z.infer<
    typeof GetWorkspaceSettingsFeatureOutputSchema
>
