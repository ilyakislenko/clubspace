import { z } from 'zod'

import { RankGradingDeletedOutputSchema } from './schemas'

export const RemoveRankGradingCandidateOutputSchema =
    RankGradingDeletedOutputSchema

export class RemoveRankGradingCandidateFeature {
    constructor(
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly candidateId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RemoveRankGradingCandidateFeatureResponse = z.infer<
    typeof RemoveRankGradingCandidateOutputSchema
>
