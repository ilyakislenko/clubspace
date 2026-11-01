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
    // null = club-wide; otherwise counts only visits of this direction.
    directionId: z.string().nullable(),
})

// A direction the member trains in (or has visited) that has achievements:
// its own visit totals and streaks, for the per-direction tab.
export const AchievementDirectionSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable(),
    icon: z.string().nullable(),
    totalCheckIns: z.number().int(),
    currentStreakWeeks: z.number().int(),
    longestStreakWeeks: z.number().int(),
})

export const GetMyAchievementsOutputSchema = z.object({
    totalCheckIns: z.number().int(),
    currentStreakWeeks: z.number().int(),
    longestStreakWeeks: z.number().int(),
    nextMilestone: z.number().int().nullable(),
    achievements: z.array(AchievementItemSchema),
    directions: z.array(AchievementDirectionSchema),
    recentWeeks: z.array(z.number().int()), // check-ins per week, last 12 weeks, oldest first
    stats: z.object({
        firstTrainingDate: z.iso.date().nullable(), // club-local date of the first class
        monthsTraining: z.number().int(),
        avgPerMonth: z.number(),
        completedSubscriptions: z.number().int(),
    }),
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
