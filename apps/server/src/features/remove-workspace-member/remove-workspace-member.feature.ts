import { z } from 'zod'

export const RemoveWorkspaceMemberFeatureOutputSchema = z.object({
    status: z.literal('removed'),
})

export class RemoveWorkspaceMemberFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RemoveWorkspaceMemberFeatureResponse = z.infer<
    typeof RemoveWorkspaceMemberFeatureOutputSchema
>
