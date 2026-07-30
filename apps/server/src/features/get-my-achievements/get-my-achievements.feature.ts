import { z } from 'zod'

export const AchievementItemSchema = z.object({
    id: z.string(), // uuid, or "default-N" for the built-in ladder
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    metric: z.enum(['checkins', 'streak']),
    threshold: z.number().int(),
    unlocked: z.boolean(),
    achievedAt: z.iso.datetime().nullable(),
})

export const GetMyAchievementsOutputSchema = z.object({
    totalCheckIns: z.number().int(),
    currentStreakWeeks: z.number().int(),
    longestStreakWeeks: z.number().int(),
    nextMilestone: z.number().int().nullable(),
    achievements: z.array(AchievementItemSchema),
})

export class GetMyAchievementsFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyAchievementsFeatureResponse = z.infer<
    typeof GetMyAchievementsOutputSchema
>
