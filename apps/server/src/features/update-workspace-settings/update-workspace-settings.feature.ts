import { z } from 'zod'

export const UpdateWorkspaceSettingsFeatureInputSchema = z.object({
    coachSeesAllGroups: z.boolean().optional(),
    leaderboardEnabled: z.boolean().optional(),
    // IANA timezone, validated against Intl.supportedValuesOf in the
    // handler so the schema doesn't have to ship the full list.
    timezone: z.string().min(1).max(64).optional(),
})

export const UpdateWorkspaceSettingsFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    coachSeesAllGroups: z.boolean(),
    leaderboardEnabled: z.boolean(),
    timezone: z.string(),
})

export class UpdateWorkspaceSettingsFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdateWorkspaceSettingsFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateWorkspaceSettingsFeatureResponse = z.infer<
    typeof UpdateWorkspaceSettingsFeatureOutputSchema
>
