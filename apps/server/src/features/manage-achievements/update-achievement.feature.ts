import { z } from 'zod'

import { AchievementMetricSchema, AchievementOutputSchema } from './schemas'

export const UpdateAchievementInputSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    icon: z.string().trim().max(16).nullish(),
    metric: AchievementMetricSchema.optional(),
    threshold: z.number().int().positive().max(100000).optional(),
    isActive: z.boolean().optional(),
    order: z.number().int().optional(),
})

export const UpdateAchievementOutputSchema = AchievementOutputSchema

export class UpdateAchievementFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateAchievementInputSchema>,
        readonly workspaceId: string,
        readonly achievementId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateAchievementFeatureResponse = z.infer<
    typeof UpdateAchievementOutputSchema
>
