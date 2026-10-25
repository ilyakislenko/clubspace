import { z } from 'zod'

// NEVER add a `workspaceId` field here: AuthGuard reads req.body.workspaceId
// and would resolve a role for it, then refuse every non-member with 403.
export const JoinWorkspaceFeatureInputSchema = z.object({
    // Raw input (any case, with or without the hyphen); normalized server-side.
    code: z.string().trim().min(1).max(32),
    firstname: z.string().trim().min(1).max(100).optional(),
    lastname: z.string().trim().min(1).max(100).optional(),
})

export const JoinWorkspaceFeatureOutputSchema = z.object({
    status: z.enum(['active', 'pending', 'rejected']),
    created: z.boolean(),
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
})

export class JoinWorkspaceFeature {
    constructor(
        readonly payload: z.infer<typeof JoinWorkspaceFeatureInputSchema>,
        readonly invokerUserId: string,
    ) {}
}

export type JoinWorkspaceFeatureResponse = z.infer<
    typeof JoinWorkspaceFeatureOutputSchema
>
