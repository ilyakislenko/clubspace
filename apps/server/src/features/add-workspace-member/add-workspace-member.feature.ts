import { z } from 'zod'
import { emailSchema } from '../../shared/utils/email'

// Exactly one of: `email` adds (or approves) by address; `userId` approves a
// pending request — a child profile has no e-mail.
export const AddWorkspaceMemberFeatureInputSchema = z
    .object({
        email: emailSchema.optional(),
        userId: z.string().uuid().optional(),
    })
    .refine((p) => (p.email === undefined) !== (p.userId === undefined), {
        message: 'Укажите e-mail или заявку',
    })

// No membership id and no "is this a new account" flag: an existing account
// gets an offer (outcome 'invited') instead of a membership (security M8).
export const AddWorkspaceMemberFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    email: z.string().nullable(),
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
