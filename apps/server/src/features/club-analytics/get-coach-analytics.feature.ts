import { z } from 'zod'

import { AnalyticsFilterSchema, CoachAnalyticsSchema } from './schemas'

export const GetCoachAnalyticsInputSchema = AnalyticsFilterSchema

export const GetCoachAnalyticsOutputSchema = CoachAnalyticsSchema

export class GetCoachAnalyticsFeature {
    constructor(
        readonly payload: z.infer<typeof GetCoachAnalyticsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetCoachAnalyticsFeatureResponse = z.infer<typeof GetCoachAnalyticsOutputSchema>
