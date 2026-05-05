import { z } from 'zod'

export const RemoveGroupMemberFeatureOutputSchema = z.object({
    status: z.literal('removed'),
})

export class RemoveGroupMemberFeature {
    constructor(
        readonly workspaceId: string,
        readonly groupId: string,
        readonly userId: string,
        readonly invokerUserId: string,
    ) {}
}

export type RemoveGroupMemberFeatureResponse = z.infer<
    typeof RemoveGroupMemberFeatureOutputSchema
>
