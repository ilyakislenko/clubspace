import { z } from 'zod'

export const AcceptWorkspaceInvitationOutputSchema = z.object({
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    roleName: z.enum(['user', 'coach']),
    groupId: z.string().uuid().nullable(),
})

export class AcceptWorkspaceInvitationFeature {
    constructor(
        readonly invitationId: string,
        readonly invokerUserId: string,
    ) {}
}

export type AcceptWorkspaceInvitationFeatureResponse = z.infer<
    typeof AcceptWorkspaceInvitationOutputSchema
>
