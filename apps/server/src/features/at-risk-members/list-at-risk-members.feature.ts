import { z } from 'zod'

import { AtRiskMemberSchema, AtRiskSummarySchema } from './schemas'

export const ListAtRiskMembersInputSchema = z.object({
    // An enum, not a boolean: z.coerce.boolean('false') === true.
    scope: z.enum(['all', 'mine']).optional(),
    gymId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
})

export const ListAtRiskMembersOutputSchema = z.object({
    data: z.array(AtRiskMemberSchema),
    summary: AtRiskSummarySchema,
})

export class ListAtRiskMembersFeature {
    constructor(
        readonly payload: z.infer<typeof ListAtRiskMembersInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListAtRiskMembersFeatureResponse = z.infer<
    typeof ListAtRiskMembersOutputSchema
>
