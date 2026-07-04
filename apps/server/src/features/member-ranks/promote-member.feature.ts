import { z } from 'zod'

import { PromotionOutputSchema } from './schemas'

export const PromoteMemberInputSchema = z.object({
    ladderId: z.string().uuid(),
    levelId: z.string().uuid(),
    stripes: z.number().int().min(0).max(20).optional(),
    note: z.string().trim().max(500).nullable().optional(),
})
export const PromoteMemberOutputSchema = PromotionOutputSchema

export class PromoteMemberFeature {
    constructor(
        readonly payload: z.infer<typeof PromoteMemberInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type PromoteMemberFeatureResponse = z.infer<
    typeof PromoteMemberOutputSchema
>
