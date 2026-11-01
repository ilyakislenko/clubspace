import { z } from 'zod'

import { AnalyticsFilterSchema, RevenueForecastSchema } from './schemas'

export const GetRevenueForecastInputSchema = AnalyticsFilterSchema

export const GetRevenueForecastOutputSchema = RevenueForecastSchema

export class GetRevenueForecastFeature {
    constructor(
        readonly payload: z.infer<typeof GetRevenueForecastInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetRevenueForecastFeatureResponse = z.infer<typeof GetRevenueForecastOutputSchema>
