import { z } from 'zod'

export const InviteWorkspaceMemberFeatureInputSchema = z.object({
    email: z.string().trim().email().max(255),
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
    outcome: z.enum(['added', 'approved', 'restored']),
    isNewUser: z.boolean(),
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
