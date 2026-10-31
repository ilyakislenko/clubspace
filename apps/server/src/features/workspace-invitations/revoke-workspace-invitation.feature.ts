import { z } from 'zod'

export const RevokeWorkspaceInvitationOutputSchema = z.object({
    status: z.literal('revoked'),
})

export class RevokeWorkspaceInvitationFeature {
    constructor(
        readonly invitationId: string,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RevokeWorkspaceInvitationFeatureResponse = z.infer<
    typeof RevokeWorkspaceInvitationOutputSchema
>
