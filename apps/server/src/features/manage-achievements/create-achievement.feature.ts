import { z } from 'zod'

import { AchievementMetricSchema, AchievementOutputSchema } from './schemas'

export const CreateAchievementInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullish(),
    icon: z.string().trim().max(16).nullish(),
    metric: AchievementMetricSchema.default('CHECKINS'),
    threshold: z.number().int().positive().max(100000),
    isActive: z.boolean().optional(),
    order: z.number().int().optional(),
})

export const CreateAchievementOutputSchema = AchievementOutputSchema

export class CreateAchievementFeature {
    constructor(
        readonly payload: z.infer<typeof CreateAchievementInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateAchievementFeatureResponse = z.infer<
    typeof CreateAchievementOutputSchema
>
