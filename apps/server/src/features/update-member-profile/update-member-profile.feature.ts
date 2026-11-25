import { z } from 'zod'
import { emailSchema } from '../../shared/utils/email'
import { dateOfBirthSchema } from '../dependents/dependents-utils'

export const UpdateMemberProfileFeatureInputSchema = z.object({
    firstname: z.string().trim().max(100).nullable().optional(),
    lastname: z.string().trim().max(100).nullable().optional(),
    email: emailSchema.optional(),
    phone: z.string().trim().max(32).nullable().optional(),
    // YYYY-MM-DD; null clears it.
    dateOfBirth: dateOfBirthSchema.nullable().optional(),
})

export const UpdateMemberProfileFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    email: z.string().nullable(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    phone: z.string().nullable(),
    dateOfBirth: z.iso.date().nullable(),
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
