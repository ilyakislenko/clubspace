import { z } from 'zod'

import { FeatureFlagColumnsSchema } from '../../domains/workspace/feature-flags'
import { FeatureLockSchema } from '../../domains/workspace/feature-locks'

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
    // Switches the platform pinned («Установлено платформой»): the club
    // cannot change these until the lock ends or the platform lifts it.
    lockedFeatures: z.array(FeatureLockSchema),
})

export class GetWorkspaceSettingsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceSettingsFeatureResponse = z.infer<
    typeof GetWorkspaceSettingsFeatureOutputSchema
>
