import { z } from 'zod'

import { strictBoolean } from '../../../shared/utils/strict-boolean'
import { OrgEventOutputSchema } from './schemas'

export const ListOrgEventsInputSchema = z.object({
    // Past events too (default: from today on).
    includePast: strictBoolean().optional(),
})
export const ListOrgEventsOutputSchema = z.object({
    data: z.array(OrgEventOutputSchema),
})

export class ListOrgEventsFeature {
    constructor(
        readonly payload: z.infer<typeof ListOrgEventsInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListOrgEventsFeatureResponse = z.infer<typeof ListOrgEventsOutputSchema>
