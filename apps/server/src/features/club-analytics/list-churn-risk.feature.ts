import { z } from 'zod'

import { AnalyticsFilterSchema, ChurnRiskMemberSchema, ChurnRiskSummarySchema } from './schemas'

export const ListChurnRiskInputSchema = AnalyticsFilterSchema.extend({
    // Lowest score listed; default = the «средний риск» threshold.
    minScore: z.coerce.number().int().min(1).max(100).optional(),
})

export const ListChurnRiskOutputSchema = z.object({
    computedAt: z.iso.datetime().nullable(),
    data: z.array(ChurnRiskMemberSchema),
    summary: ChurnRiskSummarySchema,
})

export class ListChurnRiskFeature {
    constructor(
        readonly payload: z.infer<typeof ListChurnRiskInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListChurnRiskFeatureResponse = z.infer<typeof ListChurnRiskOutputSchema>
