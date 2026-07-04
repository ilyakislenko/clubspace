import { z } from 'zod'

import { RankLadderOutputSchema } from './schemas'

export const ListLaddersInputSchema = z.object({
    includeInactive: z.coerce.boolean().optional(),
})
export const ListLaddersOutputSchema = z.object({
    data: z.array(RankLadderOutputSchema),
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
