import { z } from 'zod'

import { RankGradingDetailOutputSchema } from './schemas'

export const UpdateRankGradingInputSchema = z
    .object({
        date: z.iso.date().optional(),
        title: z.string().trim().min(1).max(255).optional(),
        gymId: z.string().uuid().nullable().optional(),
        feeAmount: z.number().int().min(0).max(10_000_000).nullable().optional(),
        feeCurrency: z.string().trim().length(3).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'Нужно заполнить хотя бы одно поле',
    })
export const UpdateRankGradingOutputSchema = RankGradingDetailOutputSchema

export class UpdateRankGradingFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateRankGradingInputSchema>,
        readonly workspaceId: string,
        readonly gradingId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateRankGradingFeatureResponse = z.infer<
    typeof UpdateRankGradingOutputSchema
>
