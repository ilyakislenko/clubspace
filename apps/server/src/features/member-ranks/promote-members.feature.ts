import { z } from 'zod'

export const PromoteMembersInputSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1).max(500),
    levelId: z.string().uuid(),
    stripes: z.number().int().min(0).max(20).optional(),
    note: z.string().trim().max(500).nullable().optional(),
})
export const PromoteMembersOutputSchema = z.object({
    // Members who got a new promotion row.
    promoted: z.number().int(),
    // Members already at exactly this level + stripes — left untouched, so
    // re-running "give everyone a white belt" doesn't spam history or pushes.
    unchanged: z.number().int(),
})

export class PromoteMembersFeature {
    constructor(
        readonly payload: z.infer<typeof PromoteMembersInputSchema>,
        readonly workspaceId: string,
        readonly ladderId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type PromoteMembersFeatureResponse = z.infer<
    typeof PromoteMembersOutputSchema
>
