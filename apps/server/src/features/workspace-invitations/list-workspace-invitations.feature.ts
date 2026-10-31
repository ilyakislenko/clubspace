import { z } from 'zod'

import { WorkspaceInvitationOutputSchema } from './schemas'

export const ListWorkspaceInvitationsOutputSchema = z.object({
    data: z.array(WorkspaceInvitationOutputSchema),
})

export class ListWorkspaceInvitationsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListWorkspaceInvitationsFeatureResponse = z.infer<
    typeof ListWorkspaceInvitationsOutputSchema
>
