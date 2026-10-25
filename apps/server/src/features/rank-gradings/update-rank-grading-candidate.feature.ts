import { z } from 'zod'

import { RankGradingDetailOutputSchema } from './schemas'

export const UpdateRankGradingCandidateInputSchema = z
    .object({
        paid: z.boolean().optional(),
        levelId: z.string().uuid().optional(),
        stripes: z.number().int().min(0).max(20).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })
export const UpdateRankGradingCandidateOutputSchema =
    RankGradingDetailOutputSchema

export class UpdateRankGradingCandidateFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateRankGradingCandidateInputSchema>,
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly candidateId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateRankGradingCandidateFeatureResponse = z.infer<
    typeof UpdateRankGradingCandidateOutputSchema
>
