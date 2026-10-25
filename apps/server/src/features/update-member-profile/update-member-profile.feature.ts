import { z } from 'zod'
import { emailSchema } from '../../shared/utils/email'

export const UpdateMemberProfileFeatureInputSchema = z.object({
    firstname: z.string().trim().max(100).nullable().optional(),
    lastname: z.string().trim().max(100).nullable().optional(),
    email: emailSchema.optional(),
    phone: z.string().trim().max(32).nullable().optional(),
})

export const UpdateMemberProfileFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    email: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    phone: z.string().nullable(),
})

export class UpdateMemberProfileFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateMemberProfileFeatureInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateMemberProfileFeatureResponse = z.infer<
    typeof UpdateMemberProfileFeatureOutputSchema
>
