import { z } from 'zod'

import { AnalyticsFilterSchema, ScheduleOccupancySchema } from './schemas'

export const GetScheduleOccupancyInputSchema = AnalyticsFilterSchema.extend({
    weeks: z.coerce.number().int().min(1).max(26).optional(),
})

export const GetScheduleOccupancyOutputSchema = ScheduleOccupancySchema

export class GetScheduleOccupancyFeature {
    constructor(
        readonly payload: z.infer<typeof GetScheduleOccupancyInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetScheduleOccupancyFeatureResponse = z.infer<typeof GetScheduleOccupancyOutputSchema>
