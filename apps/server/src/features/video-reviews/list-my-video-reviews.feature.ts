import { z } from 'zod'

import { VideoReviewSummarySchema } from './schemas'

export const ListMyVideoReviewsFeatureOutputSchema = z.object({
    items: z.array(VideoReviewSummarySchema),
})

export class ListMyVideoReviewsFeature {
    constructor(
        readonly userId: string,
        readonly workspaceId: string,
    ) {}
}

export type ListMyVideoReviewsFeatureResponse = z.infer<
    typeof ListMyVideoReviewsFeatureOutputSchema
>
