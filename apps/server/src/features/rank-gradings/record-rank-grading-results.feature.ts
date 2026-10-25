import { z } from 'zod'

import { RankGradingDetailOutputSchema, RankGradingResultSchema } from './schemas'

export const RecordRankGradingResultsInputSchema = z.object({
    results: z
        .array(
            z.object({
                candidateId: z.string().uuid(),
                result: RankGradingResultSchema,
            }),
        )
        .min(1)
        .max(200),
})
export const RecordRankGradingResultsOutputSchema = z.object({
    // Candidates who got a new promotion in this call.
    promoted: z.number().int(),
    grading: RankGradingDetailOutputSchema,
})

export class RecordRankGradingResultsFeature {
    constructor(
        readonly payload: z.infer<typeof RecordRankGradingResultsInputSchema>,
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RecordRankGradingResultsFeatureResponse = z.infer<
    typeof RecordRankGradingResultsOutputSchema
>
