import { z } from 'zod'

import { RankGradingDetailOutputSchema } from './schemas'

export const CreateRankGradingInputSchema = z.object({
    ladderId: z.string().uuid(),
    date: z.iso.date(),
    title: z.string().trim().min(1).max(255).optional(),
    gymId: z.string().uuid().nullable().optional(),
    feeAmount: z.number().int().min(0).max(10_000_000).nullable().optional(),
    feeCurrency: z.string().length(3).optional(),
})
export const CreateRankGradingOutputSchema = RankGradingDetailOutputSchema

export class CreateRankGradingFeature {
    constructor(
        readonly payload: z.infer<typeof CreateRankGradingInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateRankGradingFeatureResponse = z.infer<
    typeof CreateRankGradingOutputSchema
>
