import { z } from 'zod'

import { RankGradingSummaryOutputSchema } from './schemas'

export const ListRankGradingsInputSchema = z.object({
    ladderId: z.string().uuid().optional(),
})
export const ListRankGradingsOutputSchema = z.object({
    data: z.array(RankGradingSummaryOutputSchema),
})

export class ListRankGradingsFeature {
    constructor(
        readonly payload: z.infer<typeof ListRankGradingsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListRankGradingsFeatureResponse = z.infer<
    typeof ListRankGradingsOutputSchema
>
