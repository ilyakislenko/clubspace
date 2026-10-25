import { z } from 'zod'

const RankRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string().nullable(),
})

export const MyRankProgressEntrySchema = z.object({
    ladderId: z.string().uuid(),
    ladderName: z.string(),
    current: z.object({
        levelId: z.string().uuid(),
        levelName: z.string(),
        color: z.string().nullable(),
        stripes: z.number().int(),
        reachedAt: z.iso.datetime(),
    }),
    nextLevel: RankRefSchema.nullable(),
    rule: z
        .object({
            minVisits: z.number().int().nullable(),
            minWeeks: z.number().int().nullable(),
        })
        .nullable(),
    visitsSince: z.number().int(),
    weeksSince: z.number().int(),
    remainingVisits: z.number().int(),
    remainingWeeks: z.number().int(),
    ready: z.boolean(),
    remainingText: z.string().nullable(),
    upcomingGrading: z
        .object({
            gradingId: z.string().uuid(),
            date: z.iso.date(),
            title: z.string(),
            gymName: z.string().nullable(),
            levelName: z.string(),
        })
        .nullable(),
})

export const GetMyRankProgressOutputSchema = z.object({
    data: z.array(MyRankProgressEntrySchema),
})

export class GetMyRankProgressFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyRankProgressFeatureResponse = z.infer<
    typeof GetMyRankProgressOutputSchema
>
