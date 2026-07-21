import { z } from 'zod'

export const GetMyAchievementsOutputSchema = z.object({
    totalCheckIns: z.number().int(),
    currentStreakWeeks: z.number().int(),
    longestStreakWeeks: z.number().int(),
    nextMilestone: z.number().int().nullable(),
    milestones: z.array(
        z.object({
            threshold: z.number().int(),
            unlocked: z.boolean(),
            achievedAt: z.iso.datetime().nullable(),
        }),
    ),
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
