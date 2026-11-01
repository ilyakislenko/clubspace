import { z } from 'zod'
import { emailSchema } from '../../shared/utils/email'

export const AddWorkspaceMemberFeatureInputSchema = z.object({
    email: emailSchema,
})

// No membership id and no "is this a new account" flag: an existing account
// gets an offer (outcome 'invited') instead of a membership (security M8).
export const AddWorkspaceMemberFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    email: z.string(),
    outcome: z.enum(['added', 'approved', 'invited']),
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
