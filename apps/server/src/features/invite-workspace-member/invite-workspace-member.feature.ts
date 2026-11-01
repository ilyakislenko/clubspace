import { z } from 'zod'
import { emailSchema } from '../../shared/utils/email'

export const InviteWorkspaceMemberFeatureInputSchema = z.object({
    email: emailSchema,
    firstname: z.string().trim().min(1).max(100).optional(),
    lastname: z.string().trim().min(1).max(100).optional(),
    role: z.enum(['user', 'coach']),
    groupId: z.string().uuid().optional(),
    sendEmail: z.boolean().default(true),
})

export const InviteWorkspaceMemberFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    email: z.string(),
    roleName: z.string(),
    // added    — a brand-new account, ACTIVE member at once;
    // approved — the person had applied to this club, now ACTIVE;
    // invited  — an existing account: an offer waits for them in the app.
    outcome: z.enum(['added', 'approved', 'invited']),
    emailSent: z.boolean(),
    groupId: z.string().uuid().nullable(),
})

export class InviteWorkspaceMemberFeature {
    constructor(
        readonly payload: z.infer<
            typeof InviteWorkspaceMemberFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type InviteWorkspaceMemberFeatureResponse = z.infer<
    typeof InviteWorkspaceMemberFeatureOutputSchema
>
