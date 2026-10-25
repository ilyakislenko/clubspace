import { z } from 'zod'

import { RankGradingDeletedOutputSchema } from './schemas'

export const DeleteRankGradingOutputSchema = RankGradingDeletedOutputSchema

export class DeleteRankGradingFeature {
    constructor(
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteRankGradingFeatureResponse = z.infer<
    typeof DeleteRankGradingOutputSchema
>
