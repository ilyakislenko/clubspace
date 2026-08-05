import { z } from 'zod'

export const GetMyWorkspaceMembershipFeatureOutputSchema = z.object({
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    role: z.string(),
    status: z.string(),
    accessUntil: z.iso.datetime().nullable(),
    isOwner: z.boolean(),
    createdAt: z.iso.datetime(),
})

export class GetMyWorkspaceMembershipFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetMyWorkspaceMembershipFeatureResponse = z.infer<
    typeof GetMyWorkspaceMembershipFeatureOutputSchema
>
