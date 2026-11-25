import { z } from 'zod'

import { OrgAnnouncementListOutputSchema } from './schemas'

export const ListOrgAnnouncementsInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})
export const ListOrgAnnouncementsOutputSchema = OrgAnnouncementListOutputSchema

export class ListOrgAnnouncementsFeature {
    constructor(
        readonly payload: z.infer<typeof ListOrgAnnouncementsInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListOrgAnnouncementsFeatureResponse = z.infer<
    typeof ListOrgAnnouncementsOutputSchema
>
