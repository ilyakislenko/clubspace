import { z } from 'zod'

import { AnnouncementListOutputSchema } from './schemas'

export const GetAnnouncementFeedInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})
export const GetAnnouncementFeedOutputSchema = AnnouncementListOutputSchema

export class GetAnnouncementFeedFeature {
    constructor(
        readonly payload: z.infer<typeof GetAnnouncementFeedInputSchema>,
        readonly workspaceId: string,
    ) {}
}
export type GetAnnouncementFeedFeatureResponse = z.infer<
    typeof GetAnnouncementFeedOutputSchema
>
