import { z } from 'zod'

import { AchievementListItemSchema } from './schemas'

export const ListAchievementsOutputSchema = z.object({
    data: z.array(AchievementListItemSchema),
})

export class ListAchievementsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListAchievementsFeatureResponse = z.infer<
    typeof ListAchievementsOutputSchema
>
