import { z } from 'zod'

export const SyncGroupMembersFeatureInputSchema = z.object({
    // Desired full membership of the group. Server diffs against current
    // and adds/removes in one transaction.
    userIds: z.array(z.string().uuid()),
})

export const SyncGroupMembersFeatureOutputSchema = z.object({
    groupId: z.string().uuid(),
    addedCount: z.number().int(),
    removedCount: z.number().int(),
    memberCount: z.number().int(),
})

export class SyncGroupMembersFeature {
    constructor(
        readonly payload: z.infer<typeof SyncGroupMembersFeatureInputSchema>,
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type SyncGroupMembersFeatureResponse = z.infer<
    typeof SyncGroupMembersFeatureOutputSchema
>
