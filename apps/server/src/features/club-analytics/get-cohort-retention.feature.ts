import { z } from 'zod'

import { AnalyticsFilterSchema, CohortRetentionSchema } from './schemas'

export const GetCohortRetentionInputSchema = AnalyticsFilterSchema

export const GetCohortRetentionOutputSchema = CohortRetentionSchema

export class GetCohortRetentionFeature {
    constructor(
        readonly payload: z.infer<typeof GetCohortRetentionInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetCohortRetentionFeatureResponse = z.infer<typeof GetCohortRetentionOutputSchema>
