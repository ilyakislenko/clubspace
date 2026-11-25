import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'
import { RankLadderOutputSchema, RankLadderTemplateRefSchema } from './schemas'

export const ListLaddersInputSchema = z.object({
    includeInactive: strictBoolean().optional(),
})
export const ListLaddersOutputSchema = z.object({
    data: z.array(RankLadderOutputSchema),
    // The federation standards the listed ladders were copied from (empty
    // when the federation hub is off).
    templates: z.array(RankLadderTemplateRefSchema),
})

export class ListLaddersFeature {
    constructor(
        readonly payload: z.infer<typeof ListLaddersInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListLaddersFeatureResponse = z.infer<
    typeof ListLaddersOutputSchema
>
