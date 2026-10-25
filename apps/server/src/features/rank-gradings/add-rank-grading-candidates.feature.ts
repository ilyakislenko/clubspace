import { z } from 'zod'

import { RankGradingDetailOutputSchema } from './schemas'

export const AddRankGradingCandidatesInputSchema = z.object({
    userIds: z.array(z.string().uuid()).min(1).max(200),
    levelId: z.string().uuid().optional(),
})
export const AddRankGradingCandidatesOutputSchema =
    RankGradingDetailOutputSchema

export class AddRankGradingCandidatesFeature {
    constructor(
        readonly payload: z.infer<typeof AddRankGradingCandidatesInputSchema>,
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type AddRankGradingCandidatesFeatureResponse = z.infer<
    typeof AddRankGradingCandidatesOutputSchema
>
