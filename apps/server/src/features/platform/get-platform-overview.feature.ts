import { z } from 'zod'

export const GetPlatformOverviewOutputSchema = z.object({
    workspaceCount: z.number().int(),
    activeWorkspaceCount: z.number().int(),
    // Excludes soft-deleted accounts (deletedAt set) so the number matches
    // "people who can sign in", not rows in the table.
    userCount: z.number().int(),
    activeMembershipCount: z.number().int(),
    platformAdminCount: z.number().int(),
    // Clubs by platform-billing status (clubs with no billing row yet are
    // on the default plan, ACTIVE, and so not in these).
    trialWorkspaceCount: z.number().int(),
    pastDueWorkspaceCount: z.number().int(),
    suspendedWorkspaceCount: z.number().int(),
})

export class GetPlatformOverviewFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetPlatformOverviewFeatureResponse = z.infer<
    typeof GetPlatformOverviewOutputSchema
>
