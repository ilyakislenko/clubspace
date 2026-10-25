import { z } from 'zod'
import { emailSchema } from '../../shared/utils/email'

export const AddWorkspaceMemberFeatureInputSchema = z.object({
    email: emailSchema,
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
