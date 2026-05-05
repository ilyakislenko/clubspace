import { z } from 'zod'

export const AddGroupMemberFeatureInputSchema = z.object({
    userId: z.string().uuid(),
})

export const AddGroupMemberFeatureOutputSchema = z.object({
    groupId: z.string().uuid(),
    userId: z.string().uuid(),
    joinedAt: z.iso.datetime(),
})

export class AddGroupMemberFeature {
    constructor(
        readonly payload: z.infer<typeof AddGroupMemberFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AddGroupMemberFeatureResponse = z.infer<
    typeof AddGroupMemberFeatureOutputSchema
>
