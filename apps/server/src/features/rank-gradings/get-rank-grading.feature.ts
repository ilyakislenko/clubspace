import { z } from 'zod'

import { RankGradingDetailOutputSchema } from './schemas'

export const GetRankGradingOutputSchema = RankGradingDetailOutputSchema

export class GetRankGradingFeature {
    constructor(
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetRankGradingFeatureResponse = z.infer<
    typeof GetRankGradingOutputSchema
>
