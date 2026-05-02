import { z } from 'zod'

export const UpdateWorkspaceMemberAccessFeatureInputSchema = z.object({
    /** ISO date(time). Pass null to remove the access deadline. */
    accessUntil: z.string().datetime().nullable(),
})

export const UpdateWorkspaceMemberAccessFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    accessUntil: z.string().datetime().nullable(),
})

export class UpdateWorkspaceMemberAccessFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdateWorkspaceMemberAccessFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateWorkspaceMemberAccessFeatureResponse = z.infer<
    typeof UpdateWorkspaceMemberAccessFeatureOutputSchema
>
