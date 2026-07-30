import { z } from 'zod'

export const AchievementMetricSchema = z.enum(['CHECKINS', 'STREAK'])

export const AchievementOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    metric: AchievementMetricSchema,
    threshold: z.number().int(),
    isActive: z.boolean(),
    order: z.number().int(),
})
export type AchievementOutput = z.infer<typeof AchievementOutputSchema>

export const AchievementDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

export const serializeAchievement = (a: {
    id: string
    workspaceId: string
    name: string
    description: string | null
    icon: string | null
    metric: 'CHECKINS' | 'STREAK'
    threshold: number
    isActive: boolean
    order: number
}): AchievementOutput => ({
    id: a.id,
    workspaceId: a.workspaceId,
    name: a.name,
    description: a.description,
    icon: a.icon,
    metric: a.metric,
    threshold: a.threshold,
    isActive: a.isActive,
    order: a.order,
})
