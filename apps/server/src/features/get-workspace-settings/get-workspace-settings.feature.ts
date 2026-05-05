import { z } from 'zod'

export const GetWorkspaceSettingsFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    coachSeesAllGroups: z.boolean(),
})

export class GetWorkspaceSettingsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceSettingsFeatureResponse = z.infer<
    typeof GetWorkspaceSettingsFeatureOutputSchema
>
