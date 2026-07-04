import { z } from 'zod'

import { AnnouncementListOutputSchema } from './schemas'

export const ListAnnouncementsInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})
export const ListAnnouncementsOutputSchema = AnnouncementListOutputSchema

export class ListAnnouncementsFeature {
    constructor(
        readonly payload: z.infer<typeof ListAnnouncementsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListAnnouncementsFeatureResponse = z.infer<
    typeof ListAnnouncementsOutputSchema
>
