import { z } from 'zod'

export const AddWorkspaceMemberFeatureInputSchema = z.object({
    email: z.string().email(),
})

export const AddWorkspaceMemberFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    email: z.string(),
    isNew: z.boolean(),
})

export class AddWorkspaceMemberFeature {
    constructor(
        readonly payload: z.infer<typeof AddWorkspaceMemberFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AddWorkspaceMemberFeatureResponse = z.infer<
    typeof AddWorkspaceMemberFeatureOutputSchema
>
