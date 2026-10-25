import { z } from 'zod'

const RankRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable(),
})

export const ReadinessRuleSchema = z.object({
    minVisits: z.number().int().nullable(),
    minWeeks: z.number().int().nullable(),
})

export const RankReadinessEntrySchema = z.object({
    userId: z.string().uuid(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    email: z.string(),
    isOwner: z.boolean(),
    current: z.object({
        levelId: z.string().uuid(),
        levelName: z.string(),
        color: z.string().nullable(),
        stripes: z.number().int(),
        reachedAt: z.iso.datetime(),
    }),
    nextLevel: RankRefSchema,
    rule: ReadinessRuleSchema.nullable(),
    visitsSince: z.number().int(),
    weeksSince: z.number().int(),
    remainingVisits: z.number().int(),
    remainingWeeks: z.number().int(),
    ready: z.boolean(),
    remainingText: z.string().nullable(),
    pendingGrading: z
        .object({ id: z.string().uuid(), date: z.iso.date() })
        .nullable(),
})

export const GetRankReadinessInputSchema = z.object({
    ladderId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
})
export const GetRankReadinessOutputSchema = z.object({
    ladders: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    ladderId: z.string().uuid().nullable(),
    data: z.array(RankReadinessEntrySchema),
})

export class GetRankReadinessFeature {
    constructor(
        readonly payload: z.infer<typeof GetRankReadinessInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetRankReadinessFeatureResponse = z.infer<
    typeof GetRankReadinessOutputSchema
>
