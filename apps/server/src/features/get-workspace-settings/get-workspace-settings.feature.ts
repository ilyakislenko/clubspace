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
    // The platform VIDEO module: while false, videosEnabled cannot be turned
    // on and students see no videos whatever videosEnabled says.
    videoModuleEntitled: z.boolean(),
})

export class GetWorkspaceSettingsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceSettingsFeatureResponse = z.infer<
    typeof GetWorkspaceSettingsFeatureOutputSchema
>
