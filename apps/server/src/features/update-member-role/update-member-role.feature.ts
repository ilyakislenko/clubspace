import { z } from 'zod'

export const UpdateMemberRoleFeatureInputSchema = z.object({
    roleId: z.string().uuid(),
})

export const UpdateMemberRoleFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    roleId: z.string().uuid(),
    roleName: z.string(),
})

export class UpdateMemberRoleFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateMemberRoleFeatureInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateMemberRoleFeatureResponse = z.infer<
    typeof UpdateMemberRoleFeatureOutputSchema
>
