import { z } from 'zod'

import { ListAchievementsOutputSchema } from './list-achievements.feature'

export const ReorderAchievementsInputSchema = z.object({
    // Achievement ids in the desired display order.
    ids: z.array(z.string().uuid()).min(1).max(200),
})

export const ReorderAchievementsOutputSchema = ListAchievementsOutputSchema

export class ReorderAchievementsFeature {
    constructor(
        readonly payload: z.infer<typeof ReorderAchievementsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ReorderAchievementsFeatureResponse = z.infer<
    typeof ReorderAchievementsOutputSchema
>
