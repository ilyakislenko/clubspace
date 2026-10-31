import { z } from 'zod'

export const DeclineWorkspaceInvitationOutputSchema = z.object({
    status: z.literal('declined'),
})

export class DeclineWorkspaceInvitationFeature {
    constructor(
        readonly invitationId: string,
        readonly invokerUserId: string,
    ) {}
}

export type DeclineWorkspaceInvitationFeatureResponse = z.infer<
    typeof DeclineWorkspaceInvitationOutputSchema
>
