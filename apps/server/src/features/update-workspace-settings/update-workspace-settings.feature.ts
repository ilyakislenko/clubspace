import { z } from 'zod'

export const UpdateWorkspaceSettingsFeatureInputSchema = z.object({
    coachSeesAllGroups: z.boolean().optional(),
})

export const UpdateWorkspaceSettingsFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    coachSeesAllGroups: z.boolean(),
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
